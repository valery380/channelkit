import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Channel } from '../channels/base';
import { WhatsAppChannel } from '../channels/whatsapp';
import { Logger } from './logger';
import { loadConfig, saveConfig } from '../config/parser';
import { TwilioProvisioner } from '../provisioning/twilio';

export class ApiServer {
  private app = express();
  private latestQR: string | null = null;
  private httpServer = createServer(this.app);
  private wss: WebSocketServer;
  private server: ReturnType<typeof this.httpServer.listen> | null = null;
  private channels: Map<string, Channel> = new Map();
  private logger?: Logger;
  private startTime = Date.now();
  private publicUrl: string | null = null;
  private configPath?: string;
  private serverLogBuffer: Array<{ level: string; text: string; ts: number }> = [];
  private exposeDashboard = false;
  private apiSecret: string | null = null;
  findVoiceConfig?: (channelName: string) => any;
  tunnelStart?: () => Promise<{ url: string }>;
  tunnelStop?: () => Promise<void>;
  tunnelStatus?: () => { active: boolean; url: string | null };

  constructor(private port: number = 4000) {
    this.app.use(express.json());
    // Block dashboard/management routes for external (tunneled) requests unless allowed
    this.app.use((req, res, next) => {
      if (!this.publicUrl || this.exposeDashboard) { next(); return; }
      // Requests through cloudflared have a Cf-Connecting-Ip header
      const isExternal = req.headers['cf-connecting-ip'] ||
        (req.headers.host && !req.headers.host.includes('localhost') && !req.headers.host.includes('127.0.0.1'));
      if (!isExternal) { next(); return; }
      // Allow webhook inbound routes, async send, and health check
      const p = req.path;
      if (p.startsWith('/inbound/') || p.startsWith('/api/send/') || p === '/api/health') {
        next(); return;
      }
      res.status(403).send('Dashboard access is disabled for external requests.');
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupRoutes();
  }

  setExposeDashboard(value: boolean): void {
    this.exposeDashboard = value;
  }

  getExposeDashboard(): boolean {
    return this.exposeDashboard;
  }

  setApiSecret(secret: string | undefined): void {
    this.apiSecret = secret || null;
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
    // Broadcast new log entries via WebSocket
    logger.on('entry', (entry) => {
      const data = JSON.stringify({ type: 'newEntry', entry });
      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    });
  }

  setConfigPath(path: string): void {
    this.configPath = path;
  }

  captureConsole(): void {
    const capture = (level: string, data: any) => {
      const text = String(data).replace(/\r?\n$/, '');
      if (!text) return;
      const entry = { level, text, ts: Date.now() };
      this.serverLogBuffer.push(entry);
      if (this.serverLogBuffer.length > 500) this.serverLogBuffer.shift();
      this.broadcast({ type: 'serverLog', ...entry });
    };
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    (process.stdout as any).write = (d: any, ...a: any[]) => { capture('stdout', d); return origOut(d, ...a); };
    (process.stderr as any).write = (d: any, ...a: any[]) => { capture('stderr', d); return origErr(d, ...a); };
  }

  private broadcast(msg: any): void {
    const data = JSON.stringify(msg);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  registerChannel(name: string, channel: Channel): void {
    this.channels.set(name, channel);
    // Listen for QR events from WhatsApp channels
    channel.on('qr', (qr: string) => {
      this.latestQR = qr;
      // Notify WebSocket clients
      this.broadcast({ type: 'qr', data: qr });
    });
    channel.on('connection', () => {
      this.latestQR = null; // clear QR once connected
    });
  }

  setPublicUrl(url: string): void {
    this.publicUrl = url.replace(/\/$/, '');
  }

  clearPublicUrl(): void {
    this.publicUrl = null;
  }

  getBaseUrl(): string {
    return this.publicUrl || `http://localhost:${this.port}`;
  }

  getReplyUrl(channelName: string, jid: string): string {
    return `${this.getBaseUrl()}/api/send/${channelName}/${encodeURIComponent(jid)}`;
  }

  private setupRoutes(): void {
    // POST /api/send/:channel/:jid — async message sending
    this.app.post('/api/send/:channel/:jid', async (req, res) => {
      // Check API secret if configured
      if (this.apiSecret) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${this.apiSecret}`) {
          res.status(401).json({ error: 'Invalid or missing Authorization header' });
          return;
        }
      }

      const { channel: channelName, jid } = req.params;
      const { text, media } = req.body;

      const channel = this.channels.get(channelName);
      if (!channel) {
        res.status(404).json({ error: `Channel "${channelName}" not found` });
        return;
      }

      if (!text && !media) {
        res.status(400).json({ error: 'Must provide "text" and/or "media"' });
        return;
      }

      const start = Date.now();
      try {
        await channel.send(decodeURIComponent(jid), { text, media });
        console.log(`[api] Sent async message via ${channelName} to ${jid}`);

        // Log async message
        if (this.logger) {
          this.logger.log({
            id: `async_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Math.floor(Date.now() / 1000),
            channel: channelName,
            from: 'system (async)',
            senderName: 'Async API',
            text: text || '(media)',
            type: 'async-outbound',
            route: `/api/send/${channelName}/${jid}`,
            responseText: undefined,
            status: 'success',
            latency: Date.now() - start,
          });
        }

        res.json({ ok: true });
      } catch (err: any) {
        console.error(`[api] Failed to send:`, err);

        if (this.logger) {
          this.logger.log({
            id: `async_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Math.floor(Date.now() / 1000),
            channel: channelName,
            from: 'system (async)',
            senderName: 'Async API',
            text: text || '(media)',
            type: 'async-outbound',
            route: `/api/send/${channelName}/${jid}`,
            responseText: err.message,
            status: 'error',
            latency: Date.now() - start,
          });
        }

        res.status(500).json({ error: err.message });
      }
    });

    // POST /inbound/voice/:channel — Twilio Voice incoming call
    this.app.post('/inbound/voice/:channel', express.urlencoded({ extended: false }), (req, res) => {
      const channelName = req.params.channel;
      const channel = this.channels.get(channelName);
      if (!channel || !(channel as any).handleIncomingCall) {
        res.type('text/xml').send('<Response><Say>Service unavailable.</Say><Hangup/></Response>');
        return;
      }
      try {
        // Find voice config from service
        const voiceConfig = this.findVoiceConfig?.(channelName);
        const twiml = (channel as any).handleIncomingCall(req.body, voiceConfig);
        res.type('text/xml').send(twiml);
      } catch (err: any) {
        console.error(`[voice-inbound] Error:`, err);
        res.type('text/xml').send('<Response><Say>An error occurred.</Say><Hangup/></Response>');
      }
    });

    // POST /inbound/voice/:channel/recording — Twilio Voice recording callback
    this.app.post('/inbound/voice/:channel/recording', express.urlencoded({ extended: false }), async (req, res) => {
      const channelName = req.params.channel;
      const channel = this.channels.get(channelName);
      if (!channel || !(channel as any).handleRecording) {
        res.type('text/xml').send('<Response><Hangup/></Response>');
        return;
      }
      try {
        const voiceConfig = this.findVoiceConfig?.(channelName);
        const twiml = await (channel as any).handleRecording(req.body, voiceConfig);
        res.type('text/xml').send(twiml);
      } catch (err: any) {
        console.error(`[voice-recording] Error:`, err);
        res.type('text/xml').send('<Response><Say>An error occurred.</Say><Hangup/></Response>');
      }
    });

    // POST /inbound/voice/:channel/respond/:callSid — Twilio Voice response redirect
    this.app.post('/inbound/voice/:channel/respond/:callSid', express.urlencoded({ extended: false }), (req, res) => {
      const { channel: channelName, callSid } = req.params;
      const channel = this.channels.get(channelName);
      if (!channel || !(channel as any).handleRespond) {
        res.type('text/xml').send('<Response><Hangup/></Response>');
        return;
      }
      try {
        const voiceConfig = this.findVoiceConfig?.(channelName);
        const twiml = (channel as any).handleRespond(callSid, voiceConfig);
        res.type('text/xml').send(twiml);
      } catch (err: any) {
        console.error(`[voice-respond] Error:`, err);
        res.type('text/xml').send('<Response><Hangup/></Response>');
      }
    });

    // GET /inbound/voice/:channel/audio/:id — serve cached TTS audio
    this.app.get('/inbound/voice/:channel/audio/:id', (req, res) => {
      const { channel: channelName, id } = req.params;
      const channel = this.channels.get(channelName);
      if (!channel || !(channel as any).getAudio) {
        res.status(404).send('Not found');
        return;
      }
      const entry = (channel as any).getAudio(id);
      if (!entry) {
        res.status(404).send('Audio not found or expired');
        return;
      }
      res.set('Content-Type', entry.mimetype);
      res.set('Content-Length', String(entry.buffer.length));
      res.send(entry.buffer);
    });

    // POST /inbound/twilio/:channel — Twilio SMS inbound webhook
    this.app.post('/inbound/twilio/:channel', express.urlencoded({ extended: false }), (req, res) => {
      const channelName = req.params.channel;
      const channel = this.channels.get(channelName);
      if (!channel || !(channel as any).handleInbound) {
        res.status(404).send('<Response></Response>');
        return;
      }
      try {
        (channel as any).handleInbound(req.body);
        // Twilio expects TwiML response — empty response means no auto-reply
        res.type('text/xml').send('<Response></Response>');
      } catch (err: any) {
        console.error(`[twilio-inbound] Error:`, err);
        res.type('text/xml').send('<Response></Response>');
      }
    });

    // POST /inbound/resend/:channel — Resend inbound email webhook
    this.app.post('/inbound/resend/:channel', (req, res) => {
      const channelName = req.params.channel;
      const channel = this.channels.get(channelName);
      if (!channel || !(channel as any).handleInbound) {
        res.status(404).json({ error: `Channel "${channelName}" not found or not a Resend channel` });
        return;
      }
      try {
        (channel as any).handleInbound(req.body);
        res.json({ ok: true });
      } catch (err: any) {
        console.error(`[resend-inbound] Error:`, err);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /qr — WhatsApp QR code page
    this.app.get('/qr', async (_req, res) => {
      if (!this.latestQR) {
        res.send(`
          <html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#fff">
            <div style="text-align:center">
              <h2>No QR code available</h2>
              <p>WhatsApp is either already connected or not configured.</p>
              <script>setTimeout(() => location.reload(), 3000)</script>
            </div>
          </body></html>
        `);
        return;
      }
      try {
        const QRCode = await import('qrcode');
        const dataUrl = await QRCode.toDataURL(this.latestQR, { width: 400, margin: 2 });
        res.send(`
          <html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#fff">
            <div style="text-align:center">
              <h2>📱 Scan with WhatsApp</h2>
              <img src="${dataUrl}" style="border-radius:12px;margin:20px 0"/>
              <p style="color:#888">Settings → Linked Devices → Link a Device</p>
              <script>setTimeout(() => location.reload(), 15000)</script>
            </div>
          </body></html>
        `);
      } catch {
        res.send(`<html><body><pre>${this.latestQR}</pre></body></html>`);
      }
    });

    // GET /api/health
    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', channels: [...this.channels.keys()] });
    });

    // GET /api/logs
    this.app.get('/api/logs', (req, res) => {
      if (!this.logger) {
        res.json([]);
        return;
      }
      const { limit, channel, search } = req.query as Record<string, string>;
      const results = this.logger.search({
        limit: limit ? parseInt(limit) : undefined,
        channel: channel || undefined,
        search: search || undefined,
      });
      res.json(results);
    });

    // GET /api/logs/stats
    this.app.get('/api/logs/stats', (_req, res) => {
      if (!this.logger) {
        res.json({ total: 0, byChannel: {}, avgLatency: 0, uptime: 0, channels: [] });
        return;
      }
      const stats = this.logger.getStats();
      res.json({
        ...stats,
        uptime: Date.now() - this.startTime,
        channels: [...this.channels.keys()],
      });
    });

    // DELETE /api/logs — clear all log entries from the database
    this.app.delete('/api/logs', (_req, res) => {
      if (!this.logger) { res.json({ ok: true }); return; }
      this.logger.clear();
      res.json({ ok: true });
    });

    // GET /api/server-logs — return captured stdout/stderr buffer
    this.app.get('/api/server-logs', (_req, res) => {
      res.json(this.serverLogBuffer);
    });

    // DELETE /api/server-logs — clear the server log buffer
    this.app.delete('/api/server-logs', (_req, res) => {
      this.serverLogBuffer = [];
      res.json({ ok: true });
    });

    // GET /api/tunnel/status — return current tunnel state
    this.app.get('/api/tunnel/status', (_req, res) => {
      if (!this.tunnelStatus) {
        res.json({ active: false, url: null });
        return;
      }
      res.json(this.tunnelStatus());
    });

    // POST /api/tunnel/start — start cloudflared tunnel
    this.app.post('/api/tunnel/start', async (_req, res) => {
      if (!this.tunnelStart) {
        res.status(503).json({ error: 'Tunnel not available' });
        return;
      }
      try {
        const result = await this.tunnelStart();
        this.broadcast({ type: 'tunnelStatus', active: true, url: result.url });
        res.json({ ok: true, url: result.url });
      } catch (err: any) {
        this.broadcast({ type: 'tunnelStatus', active: false, url: null, error: err.message });
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/tunnel/stop — stop cloudflared tunnel
    this.app.post('/api/tunnel/stop', async (_req, res) => {
      if (!this.tunnelStop) {
        res.status(503).json({ error: 'Tunnel not available' });
        return;
      }
      try {
        await this.tunnelStop();
        this.broadcast({ type: 'tunnelStatus', active: false, url: null });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT /api/tunnel/config — save tunnel token + hostname to config
    this.app.put('/api/tunnel/config', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { token, public_url } = req.body;
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (!config.tunnel) config.tunnel = {};
        if (token) {
          config.tunnel.token = token;
        } else {
          delete config.tunnel.token;
        }
        if (public_url) {
          config.tunnel.public_url = public_url;
        } else {
          delete config.tunnel.public_url;
        }
        if (!config.tunnel.provider) config.tunnel.provider = 'cloudflared';
        saveConfig(this.configPath, config);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/tunnel/config — get current tunnel token/hostname from config
    this.app.get('/api/tunnel/config', (_req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      try {
        const config = loadConfig(this.configPath, { validate: false });
        res.json({
          token: config.tunnel?.token || null,
          public_url: config.tunnel?.public_url || null,
          expose_dashboard: this.exposeDashboard,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/tunnel/update-webhooks — re-point all SMS webhook-mode channels to current public URL
    this.app.post('/api/tunnel/update-webhooks', async (_req, res) => {
      if (!this.publicUrl) {
        res.status(400).json({ error: 'No public URL — externalize first' });
        return;
      }
      if (!this.configPath) {
        res.status(503).json({ error: 'Config path not set' });
        return;
      }
      try {
        const config = loadConfig(this.configPath, { validate: false });
        const updated: string[] = [];
        const errors: Array<{ name: string; error: string }> = [];

        for (const [name, ch] of Object.entries(config.channels)) {
          if (ch.type !== 'sms') continue;
          if ((ch as any).poll_interval) continue; // polling mode — skip
          try {
            const Twilio = (await import('twilio')).default;
            const client = Twilio((ch as any).account_sid as string, (ch as any).auth_token as string);
            const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: (ch as any).number as string, limit: 1 });
            if (numbers.length > 0) {
              const webhookUrl = `${this.publicUrl}/inbound/twilio/${name}`;
              await client.incomingPhoneNumbers(numbers[0].sid).update({ smsUrl: webhookUrl, smsMethod: 'POST' });
              console.log(`📱 Updated Twilio SMS webhook for "${name}" → ${webhookUrl}`);
              updated.push(name);
            } else {
              errors.push({ name, error: `Phone number ${(ch as any).number} not found in Twilio` });
            }
          } catch (err: any) {
            errors.push({ name, error: err.message });
          }
        }

        res.json({ ok: true, updated, errors });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT /api/tunnel/expose-dashboard — toggle dashboard access via tunnel
    this.app.put('/api/tunnel/expose-dashboard', (req, res) => {
      const { enabled } = req.body;
      this.exposeDashboard = !!enabled;
      // Persist to config
      if (this.configPath) {
        try {
          const config = loadConfig(this.configPath, { validate: false });
          if (!config.tunnel) config.tunnel = {};
          config.tunnel.expose_dashboard = this.exposeDashboard;
          saveConfig(this.configPath, config);
        } catch {}
      }
      this.broadcast({ type: 'tunnelStatus', active: !!this.publicUrl, url: this.publicUrl, exposeDashboard: this.exposeDashboard });
      res.json({ ok: true, expose_dashboard: this.exposeDashboard });
    });

    // GET /api/config — return channels and services from config file
    this.app.get('/api/config', (_req, res) => {
      if (!this.configPath) {
        res.status(503).json({ error: 'Config path not set' });
        return;
      }
      try {
        const config = loadConfig(this.configPath, { validate: false });
        res.json({ channels: config.channels, services: config.services || {}, api_secret: config.api_secret || null });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/config/services — add a new service
    this.app.post('/api/config/services', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name, channel, webhook, code, command } = req.body;
      if (!name || !channel || !webhook) {
        res.status(400).json({ error: 'name, channel, and webhook are required' });
        return;
      }
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (!config.services) config.services = {};
        if (config.services[name]) {
          res.status(409).json({ error: `Service "${name}" already exists` });
          return;
        }
        if (!config.channels[channel]) {
          res.status(400).json({ error: `Channel "${channel}" does not exist` });
          return;
        }
        config.services[name] = { channel, webhook, ...(code && { code }), ...(command && { command }) };
        saveConfig(this.configPath, config);
        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT /api/config/services/:name — update service fields (webhook, code, command)
    this.app.put('/api/config/services/:name', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name } = req.params;
      const { webhook, code, command } = req.body;
      if (!webhook) { res.status(400).json({ error: 'webhook is required' }); return; }
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (!config.services?.[name]) {
          res.status(404).json({ error: `Service "${name}" not found` });
          return;
        }
        config.services[name].webhook = webhook;
        if (code) { config.services[name].code = code; } else { delete config.services[name].code; }
        if (command) { config.services[name].command = command; } else { delete config.services[name].command; }
        saveConfig(this.configPath, config);
        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // DELETE /api/config/services/:name — remove a service
    this.app.delete('/api/config/services/:name', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name } = req.params;
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (!config.services?.[name]) {
          res.status(404).json({ error: `Service "${name}" not found` });
          return;
        }
        delete config.services![name];
        saveConfig(this.configPath, config);
        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/config/channels — add a new channel
    this.app.post('/api/config/channels', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name, ...fields } = req.body;
      if (!name || !fields.type) {
        res.status(400).json({ error: 'name and type are required' });
        return;
      }
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (config.channels[name]) {
          res.status(409).json({ error: `Channel "${name}" already exists` });
          return;
        }
        config.channels[name] = fields;
        saveConfig(this.configPath, config);
        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT /api/config/channels/:name — update channel settings (unmatched policy)
    this.app.put('/api/config/channels/:name', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name } = req.params;
      const { unmatched } = req.body;
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (!config.channels[name]) {
          res.status(404).json({ error: `Channel "${name}" not found` });
          return;
        }
        if (unmatched) {
          config.channels[name].unmatched = unmatched;
        } else {
          delete config.channels[name].unmatched;
        }
        saveConfig(this.configPath, config);
        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // PUT /api/config/channels/:name/sms-settings — update SMS inbound mode and Twilio webhook
    this.app.put('/api/config/channels/:name/sms-settings', async (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name } = req.params;
      const { inbound_mode, poll_interval } = req.body;

      if (!inbound_mode || !['polling', 'webhook'].includes(inbound_mode)) {
        res.status(400).json({ error: 'inbound_mode must be "polling" or "webhook"' });
        return;
      }

      try {
        const config = loadConfig(this.configPath, { validate: false });
        const ch = config.channels[name];
        if (!ch) {
          res.status(404).json({ error: `Channel "${name}" not found` });
          return;
        }
        if (ch.type !== 'sms') {
          res.status(400).json({ error: 'Not an SMS channel' });
          return;
        }

        // Validate tunnel is active for webhook mode
        if (inbound_mode === 'webhook' && !this.publicUrl) {
          res.status(400).json({ error: 'Service is not externalized. Please externalize first.' });
          return;
        }

        // Update config
        if (inbound_mode === 'polling') {
          ch.poll_interval = parseInt(poll_interval) || 60;
        } else {
          delete ch.poll_interval;
        }

        saveConfig(this.configPath, config);

        // Update Twilio webhook
        try {
          const Twilio = (await import('twilio')).default;
          const client = Twilio(ch.account_sid as string, ch.auth_token as string);
          const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: ch.number as string, limit: 1 });
          if (numbers.length > 0) {
            const numberSid = numbers[0].sid;
            if (inbound_mode === 'webhook') {
              const webhookUrl = `${this.publicUrl}/inbound/twilio/${name}`;
              await client.incomingPhoneNumbers(numberSid).update({ smsUrl: webhookUrl, smsMethod: 'POST' });
              console.log(`📱 Updated Twilio SMS webhook to ${webhookUrl}`);
            } else {
              await client.incomingPhoneNumbers(numberSid).update({ smsUrl: 'https://api.vapi.ai/twilio/sms', smsMethod: 'POST' });
              console.log(`📱 Reverted Twilio SMS webhook to default`);
            }
          } else {
            console.warn(`⚠️ Twilio number ${ch.number} not found — webhook not updated`);
          }
        } catch (twilioErr: any) {
          console.error(`[sms-settings] Twilio webhook update failed: ${twilioErr.message}`);
        }

        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // DELETE /api/config/channels/:name — remove a channel and its dependent services
    this.app.delete('/api/config/channels/:name', (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name } = req.params;
      try {
        const config = loadConfig(this.configPath, { validate: false });
        if (!config.channels[name]) {
          res.status(404).json({ error: `Channel "${name}" not found` });
          return;
        }
        delete config.channels[name];
        // Remove all services that reference this channel
        if (config.services) {
          for (const [svcName, svc] of Object.entries(config.services)) {
            if (svc.channel === name) delete config.services[svcName];
          }
        }
        saveConfig(this.configPath, config);
        this.broadcast({ type: 'configChanged' });
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/config/channels/:name/pair — trigger WhatsApp QR pairing
    this.app.post('/api/config/channels/:name/pair', async (req, res) => {
      if (!this.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
      const { name } = req.params;
      try {
        const config = loadConfig(this.configPath, { validate: false });
        const ch = config.channels[name];
        if (!ch) { res.status(404).json({ error: `Channel "${name}" not found` }); return; }
        if (ch.type !== 'whatsapp') { res.status(400).json({ error: 'Only WhatsApp channels support QR pairing' }); return; }

        const { rm } = await import('fs/promises');
        const { join } = await import('path');
        const authDir = join(process.cwd(), 'auth', `whatsapp-${name}`);

        // Clear stale auth state so Baileys starts fresh with a new QR
        await rm(authDir, { recursive: true, force: true });

        // Respond immediately — QR progress arrives via WebSocket
        res.json({ ok: true, message: 'Pairing started. Watch for QR code.' });

        // Create a real channel instance and call connect() — this produces
        // a single Baileys socket whose QR is shown both in the terminal and
        // broadcast to the dashboard (same QR everywhere).
        const tempChannel = new WhatsAppChannel(name, ch as any);
        const QRCode = await import('qrcode');

        tempChannel.on('qr', async (qr: string) => {
          try {
            const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
            this.broadcast({ type: 'whatsapp-qr', channel: name, dataUrl });
          } catch {
            this.broadcast({ type: 'whatsapp-qr', channel: name, dataUrl: null });
          }
        });

        tempChannel.on('connected', () => {
          this.broadcast({ type: 'whatsapp-paired', channel: name });
          // Pairing done — disconnect; the real channel starts on next server restart
          tempChannel.disconnect().catch(() => {});
        });

        // Start the connection (shows QR in terminal + emits events)
        tempChannel.connect().catch((err: any) => {
          this.broadcast({ type: 'whatsapp-pair-error', channel: name, error: err.message });
        });

        // Timeout — if not paired within 60s, clean up
        setTimeout(() => {
          tempChannel.disconnect().catch(() => {});
        }, 65000);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/twilio/search-numbers — search available Twilio numbers
    this.app.post('/api/twilio/search-numbers', async (req, res) => {
      const { account_sid, auth_token, country_code, type, limit } = req.body;
      if (!account_sid || !auth_token || !country_code) {
        res.status(400).json({ error: 'account_sid, auth_token, and country_code are required' });
        return;
      }
      try {
        const provisioner = new TwilioProvisioner({ accountSid: account_sid, authToken: auth_token });
        const numbers = await provisioner.searchNumbers(country_code, {
          type: type || 'mobile',
          limit: limit || 10,
        });
        res.json({ numbers });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/twilio/buy-number — purchase a Twilio number and create channels
    this.app.post('/api/twilio/buy-number', async (req, res) => {
      const { account_sid, auth_token, phone_number } = req.body;
      if (!account_sid || !auth_token || !phone_number) {
        res.status(400).json({ error: 'account_sid, auth_token, and phone_number are required' });
        return;
      }
      try {
        const provisioner = new TwilioProvisioner({ accountSid: account_sid, authToken: auth_token });
        const purchased = await provisioner.purchaseNumber(phone_number);
        res.json({ ok: true, purchased });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/restart — restart the ChannelKit process
    this.app.post('/api/restart', (_req, res) => {
      res.json({ ok: true });
      setTimeout(async () => {
        const { spawn } = await import('child_process');
        const { join } = await import('path');
        const { existsSync } = await import('fs');
        // tsx strips itself from process.argv, so argv[1] is the .ts entry
        // file (not the tsx binary). Detect this and re-spawn via tsx so its
        // ESM hooks are registered; otherwise Node will reject .ts extensions.
        const argv1 = process.argv[1] || '';
        const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
        const tsxCmd = existsSync(tsxBin) ? tsxBin : 'tsx';
        let cmd: string;
        let args: string[];
        if (argv1.endsWith('.ts')) {
          // tsx stripped itself: argv = [node, src/cli.ts, start, ...]
          cmd = tsxCmd;
          args = process.argv.slice(1); // ['src/cli.ts', 'start', ...]
        } else if (argv1.includes('tsx')) {
          // tsx present as argv[1]: argv = [node, /path/tsx, src/cli.ts, ...]
          cmd = tsxCmd;
          args = process.argv.slice(2); // ['src/cli.ts', 'start', ...]
        } else {
          // Compiled JS — spawn node directly
          cmd = process.execPath;
          args = process.argv.slice(1);
        }
        // Gracefully disconnect all channels before spawning the new process.
        // This is critical for Telegram (grammY) — if getUpdates is still active
        // when the new process starts polling with the same token, Telegram
        // returns 409 Conflict. Awaiting disconnect() lets grammY finish cleanly.
        await Promise.allSettled([...this.channels.values()].map(ch => ch.disconnect()));

        const child = spawn(cmd, args, {
          detached: true,
          stdio: 'inherit',
          env: process.env,
          cwd: process.cwd(),
        });
        child.unref();
        process.exit(0);
      }, 300);
    });

    // GET /dashboard — serve the HTML dashboard
    this.app.get('/dashboard', (_req, res) => {
      const htmlPath = join(__dirname, '..', 'dashboard', 'index.html');
      try {
        const html = readFileSync(htmlPath, 'utf-8');
        res.type('html').send(html);
      } catch {
        // Try source path (for tsx/dev mode)
        try {
          const devPath = join(__dirname, '..', '..', 'src', 'dashboard', 'index.html');
          const html = readFileSync(devPath, 'utf-8');
          res.type('html').send(html);
        } catch {
          res.status(404).send('Dashboard HTML not found');
        }
      }
    });
  }

  async start(): Promise<void> {
    const portInUse = await this.isPortInUse(this.port);
    if (portInUse) {
      const freed = await this.promptKillExistingProcess(this.port);
      if (!freed) {
        console.log('[api] Exiting — port is in use.');
        process.exit(1);
      }
      // Recreate HTTP server and WSS since the old ones may be in a bad state
      this.httpServer = createServer(this.app);
      this.wss = new WebSocketServer({ server: this.httpServer });
    }

    return new Promise((resolve, reject) => {
      this.server = this.httpServer.listen(this.port, () => {
        console.log(`[api] Async API listening on port ${this.port}`);
        console.log(`📊 Dashboard: http://localhost:${this.port}/dashboard`);
        resolve();
      });
      this.server.on('error', (err: Error) => reject(err));
    });
  }

  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = require('net').createServer()
        .once('error', (err: NodeJS.ErrnoException) => {
          resolve(err.code === 'EADDRINUSE');
        })
        .once('listening', () => {
          tester.close(() => resolve(false));
        })
        .listen(port);
    });
  }

  private async promptKillExistingProcess(port: number): Promise<boolean> {
    const { execSync } = await import('child_process');
    const { createInterface } = await import('readline');

    // Find the PID using the port
    let pid: string | undefined;
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' }).trim();
      pid = out.split('\n')[0];
    } catch {
      // lsof may fail if no process found or not available
    }

    const pidInfo = pid ? ` (PID ${pid})` : '';
    console.error(`\n⚠️  Port ${port} is already in use${pidInfo}.`);

    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise<string>((res) => {
      rl.question(`   Kill the existing process and continue? [y/N] `, (ans) => {
        rl.close();
        res(ans.trim().toLowerCase());
      });
    });

    if (answer === 'y' || answer === 'yes') {
      try {
        if (pid) {
          execSync(`kill -9 ${pid}`);
        } else {
          execSync(`lsof -ti tcp:${port} | xargs kill -9`);
        }
        console.log(`   Killed process on port ${port}. Waiting for port to be released...`);
        // Wait until the port is actually free (up to 5 seconds)
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (!(await this.isPortInUse(port))) return true;
        }
        console.error(`   Port ${port} is still in use after waiting.`);
        return false;
      } catch (killErr: any) {
        console.error(`   Failed to kill process: ${killErr.message}`);
        return false;
      }
    }
    return false;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
