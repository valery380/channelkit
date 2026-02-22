import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Channel } from '../channels/base';
import { Logger } from './logger';

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
  findVoiceConfig?: (channelName: string) => any;

  constructor(private port: number = 4000) {
    this.app.use(express.json());
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupRoutes();
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

  getBaseUrl(): string {
    return this.publicUrl || `http://localhost:${this.port}`;
  }

  getReplyUrl(channelName: string, jid: string): string {
    return `${this.getBaseUrl()}/api/send/${channelName}/${encodeURIComponent(jid)}`;
  }

  private setupRoutes(): void {
    // POST /api/send/:channel/:jid — async message sending
    this.app.post('/api/send/:channel/:jid', async (req, res) => {
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
    return new Promise((resolve) => {
      this.server = this.httpServer.listen(this.port, () => {
        console.log(`[api] Async API listening on port ${this.port}`);
        console.log(`📊 Dashboard: http://localhost:${this.port}/dashboard`);
        resolve();
      });
    });
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
