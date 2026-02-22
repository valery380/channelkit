import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Channel } from '../channels/base';
import { Logger } from './logger';

export class ApiServer {
  private app = express();
  private httpServer = createServer(this.app);
  private wss: WebSocketServer;
  private server: ReturnType<typeof this.httpServer.listen> | null = null;
  private channels: Map<string, Channel> = new Map();
  private logger?: Logger;
  private startTime = Date.now();
  private publicUrl: string | null = null;

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

  registerChannel(name: string, channel: Channel): void {
    this.channels.set(name, channel);
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
