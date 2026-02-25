import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Channel } from '../channels/base';
import { Logger } from '../core/logger';
import { ServerContext } from './types';
import { externalAccessGuard } from './middleware/auth';
import { registerSendRoutes } from './routes/send';
import { registerInboundRoutes } from './routes/inbound';
import { registerConfigRoutes } from './routes/config';
import { registerTunnelRoutes } from './routes/tunnel';
import { registerSettingsRoutes } from './routes/settings';
import { registerTwilioRoutes } from './routes/twilio';
import { registerLogRoutes } from './routes/logs';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerRestartRoutes } from './routes/restart';

export class ApiServer {
  private app = express();
  private httpServer = createServer(this.app);
  private server: ReturnType<typeof this.httpServer.listen> | null = null;
  private ctx: ServerContext;

  constructor(private port: number = 4000) {
    const wss = new WebSocketServer({ server: this.httpServer });

    const broadcast = (msg: any) => {
      const data = JSON.stringify(msg);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    };

    this.ctx = {
      channels: new Map(),
      logger: undefined,
      configPath: undefined,
      publicUrl: null,
      exposeDashboard: false,
      apiSecret: null,
      startTime: Date.now(),
      serverLogBuffer: [],
      latestQR: null,
      wss,
      broadcast,
      findVoiceConfig: undefined,
      tunnelStart: undefined,
      tunnelStop: undefined,
      tunnelStatus: undefined,
      setPublicUrl: (url: string) => { this.ctx.publicUrl = url.replace(/\/$/, ''); },
      clearPublicUrl: () => { this.ctx.publicUrl = null; },
      getBaseUrl: () => this.ctx.publicUrl || `http://localhost:${this.port}`,
      getReplyUrl: (channelName: string, jid: string) =>
        `${this.ctx.getBaseUrl()}/api/send/${channelName}/${encodeURIComponent(jid)}`,
      setExposeDashboard: (value: boolean) => { this.ctx.exposeDashboard = value; },
    };

    this.app.use(express.json());
    this.app.use(externalAccessGuard(this.ctx));

    // Register all route modules
    registerSendRoutes(this.app, this.ctx);
    registerInboundRoutes(this.app, this.ctx);
    registerConfigRoutes(this.app, this.ctx);
    registerTunnelRoutes(this.app, this.ctx);
    registerSettingsRoutes(this.app, this.ctx);
    registerTwilioRoutes(this.app, this.ctx);
    registerLogRoutes(this.app, this.ctx);
    registerDashboardRoutes(this.app, this.ctx);
    registerRestartRoutes(this.app, this.ctx);
  }

  // Proxy getters/setters that delegate to ctx for backward compat with index.ts
  setExposeDashboard(value: boolean): void { this.ctx.setExposeDashboard(value); }
  getExposeDashboard(): boolean { return this.ctx.exposeDashboard; }
  setApiSecret(secret: string | undefined): void { this.ctx.apiSecret = secret || null; }

  setLogger(logger: Logger): void {
    this.ctx.logger = logger;
    logger.on('entry', (entry) => {
      this.ctx.broadcast({ type: 'newEntry', entry });
    });
  }

  setConfigPath(path: string): void { this.ctx.configPath = path; }

  captureConsole(): void {
    const capture = (level: string, data: any) => {
      const text = String(data).replace(/\r?\n$/, '');
      if (!text) return;
      const entry = { level, text, ts: Date.now() };
      this.ctx.serverLogBuffer.push(entry);
      if (this.ctx.serverLogBuffer.length > 500) this.ctx.serverLogBuffer.shift();
      this.ctx.broadcast({ type: 'serverLog', ...entry });
    };
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    (process.stdout as any).write = (d: any, ...a: any[]) => { capture('stdout', d); return origOut(d, ...a); };
    (process.stderr as any).write = (d: any, ...a: any[]) => { capture('stderr', d); return origErr(d, ...a); };
  }

  registerChannel(name: string, channel: Channel): void {
    this.ctx.channels.set(name, channel);
    channel.on('qr', (qr: string) => {
      this.ctx.latestQR = qr;
      this.ctx.broadcast({ type: 'qr', data: qr });
    });
    channel.on('connection', () => {
      this.ctx.latestQR = null;
    });
  }

  setPublicUrl(url: string): void { this.ctx.setPublicUrl(url); }
  clearPublicUrl(): void { this.ctx.clearPublicUrl(); }
  getBaseUrl(): string { return this.ctx.getBaseUrl(); }
  getReplyUrl(channelName: string, jid: string): string { return this.ctx.getReplyUrl(channelName, jid); }

  // Direct property setters used by index.ts — proxy to ctx
  set findVoiceConfig(fn: ((channelName: string) => any) | undefined) { this.ctx.findVoiceConfig = fn; }
  set tunnelStart(fn: (() => Promise<{ url: string }>) | undefined) { this.ctx.tunnelStart = fn; }
  set tunnelStop(fn: (() => Promise<void>) | undefined) { this.ctx.tunnelStop = fn; }
  set tunnelStatus(fn: (() => { active: boolean; url: string | null }) | undefined) { this.ctx.tunnelStatus = fn; }

  async start(): Promise<void> {
    const portInUse = await this.isPortInUse(this.port);
    if (portInUse) {
      const freed = await this.promptKillExistingProcess(this.port);
      if (!freed) {
        console.log('[api] Exiting — port is in use.');
        process.exit(1);
      }
      this.httpServer = createServer(this.app);
      this.ctx.wss = new WebSocketServer({ server: this.httpServer });
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

    let pid: string | undefined;
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' }).trim();
      pid = out.split('\n')[0];
    } catch {}

    const pidInfo = pid ? ` (PID ${pid})` : '';

    // If stdin is not a TTY (e.g. running under tsx watch), auto-kill
    // the existing process instead of prompting — readline won't work
    // and would cause an infinite restart loop.
    const autoKill = !process.stdin.isTTY;

    if (!autoKill) {
      console.error(`\n⚠️  Port ${port} is already in use${pidInfo}.`);
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise<string>((res) => {
        rl.question(`   Kill the existing process and continue? [y/N] `, (ans) => {
          rl.close();
          res(ans.trim().toLowerCase());
        });
      });
      if (answer !== 'y' && answer !== 'yes') return false;
    } else {
      console.error(`\n⚠️  Port ${port} is already in use${pidInfo}. Auto-killing...`);
    }

    try {
      try {
        execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null`, { encoding: 'utf-8' });
      } catch {}
      console.log(`   Killed process on port ${port}. Waiting for port to be released...`);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (!(await this.isPortInUse(port))) return true;
        try {
          execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null`, { encoding: 'utf-8' });
        } catch {}
      }
      console.error(`   Port ${port} is still in use after waiting.`);
      return false;
    } catch (killErr: any) {
      console.error(`   Failed to kill process: ${killErr.message}`);
      return false;
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.ctx.wss.close();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
