import express from 'express';
import { Channel } from '../channels/base';

export class ApiServer {
  private app = express();
  private server: ReturnType<typeof this.app.listen> | null = null;
  private channels: Map<string, Channel> = new Map();

  constructor(private port: number = 4000) {
    this.app.use(express.json());
    this.setupRoutes();
  }

  registerChannel(name: string, channel: Channel): void {
    this.channels.set(name, channel);
  }

  getBaseUrl(): string {
    return `http://localhost:${this.port}`;
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

      try {
        await channel.send(decodeURIComponent(jid), { text, media });
        console.log(`[api] Sent async message via ${channelName} to ${jid}`);
        res.json({ ok: true });
      } catch (err: any) {
        console.error(`[api] Failed to send:`, err);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/health
    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', channels: [...this.channels.keys()] });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`[api] Async API listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
