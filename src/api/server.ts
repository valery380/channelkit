import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import { timingSafeEqual } from 'crypto';
import { Channel } from '../channels/base';
import { Logger } from '../core/logger';
import { ServerContext } from './types';
import { mcpCors, externalAccessGuard, mcpAuthCheck, adminAuthCheck } from './middleware/auth';
import { registerSendRoutes } from './routes/send';
import { registerInboundRoutes } from './routes/inbound';
import { registerConfigRoutes } from './routes/config';
import { registerTunnelRoutes } from './routes/tunnel';
import { registerSettingsRoutes } from './routes/settings';
import { registerTwilioRoutes } from './routes/twilio';
import { registerLogRoutes } from './routes/logs';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerRestartRoutes } from './routes/restart';
import { registerMcpRoutes } from './routes/mcp';
import { registerUpdateRoutes } from './routes/update';
import { registerGroupRoutes } from './routes/groups';

/** Redact patterns that look like API keys/tokens from log text. */
function redactSecrets(text: string): string {
  // Common API key patterns (long hex, base64, bearer tokens in log output)
  return text
    .replace(/\b(re_[A-Za-z0-9_]{20,})\b/g, 're_****')
    .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, 'sk-****')
    .replace(/\b(whsec_[A-Za-z0-9_]{20,})\b/g, 'whsec_****')
    .replace(/\b(AC[a-f0-9]{32})\b/g, 'AC****')
    .replace(/\b(AIzaSy[A-Za-z0-9_-]{33})\b/g, 'AIza****')
    .replace(/\b(eyJ[A-Za-z0-9_-]{50,})\b/g, 'eyJ****');
}

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
      exposeMcp: false,
      apiSecret: null,
      mcpSecret: null,
      startTime: Date.now(),
      serverLogBuffer: [],
      latestQR: null,
      wss,
      broadcast,
      findVoiceConfig: undefined,
      tunnelStart: undefined,
      tunnelStop: undefined,
      tunnelStatus: undefined,
      mcpStart: undefined,
      mcpStop: undefined,
      mcpStatus: undefined,
      updateStatus: undefined,
      updateTrigger: undefined,
      setPublicUrl: (url: string) => { this.ctx.publicUrl = url.replace(/\/$/, ''); },
      clearPublicUrl: () => { this.ctx.publicUrl = null; },
      getBaseUrl: () => this.ctx.publicUrl || `http://localhost:${this.port}`,
      getReplyUrl: (channelName: string, jid: string) =>
        `${this.ctx.getBaseUrl()}/api/send/${channelName}/${encodeURIComponent(jid)}`,
      setExposeDashboard: (value: boolean) => { this.ctx.exposeDashboard = value; },
      setExposeMcp: (value: boolean) => { this.ctx.exposeMcp = value; },
    };

    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
    }));

    // Body size limits
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(mcpCors(this.ctx));
    this.app.use(externalAccessGuard(this.ctx));
    this.app.use(mcpAuthCheck(this.ctx));
    this.app.use(adminAuthCheck(this.ctx));

    // Rate limiting — stricter for send/inbound, looser for dashboard
    const sendLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later' },
    });
    const inboundLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    });
    const dashboardLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/send', sendLimiter);
    this.app.use('/inbound', inboundLimiter);
    this.app.use('/api', dashboardLimiter);

    // Auth check endpoint — lets the dashboard verify if a secret is required/valid
    this.app.get('/api/auth/check', (_req, res) => {
      if (!this.ctx.apiSecret) {
        res.json({ required: false });
        return;
      }
      const auth = _req.headers.authorization;
      if (auth) {
        const expected = `Bearer ${this.ctx.apiSecret}`;
        const valid = auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
        res.json({ required: true, valid });
      } else {
        res.json({ required: true, valid: false });
      }
    });

    // WebSocket authentication
    wss.on('connection', (ws, req) => {
      if (this.ctx.apiSecret) {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const token = url.searchParams.get('token');
        if (!token || token.length !== this.ctx.apiSecret.length ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(this.ctx.apiSecret))) {
          ws.close(4401, 'Unauthorized');
          return;
        }
      }
    });

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
    registerMcpRoutes(this.app, this.ctx);
    registerUpdateRoutes(this.app, this.ctx);
    registerGroupRoutes(this.app, this.ctx);
  }

  // Proxy getters/setters that delegate to ctx for backward compat with index.ts
  setExposeDashboard(value: boolean): void { this.ctx.setExposeDashboard(value); }
  getExposeDashboard(): boolean { return this.ctx.exposeDashboard; }
  setApiSecret(secret: string | number | undefined): void { this.ctx.apiSecret = secret != null ? String(secret) : null; }
  setMcpSecret(secret: string | number | undefined): void { this.ctx.mcpSecret = secret != null ? String(secret) : null; }

  setLogger(logger: Logger): void {
    this.ctx.logger = logger;
    logger.on('entry', (entry) => {
      this.ctx.broadcast({ type: 'newEntry', entry });
    });
  }

  setConfigPath(path: string): void { this.ctx.configPath = path; }

  captureConsole(): void {
    const capture = (level: string, data: any) => {
      const text = redactSecrets(String(data).replace(/\r?\n$/, ''));
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
      // Send raw QR string — frontend renders it
      this.ctx.broadcast({ type: 'whatsapp-qr', channel: name, qr });
    });
    channel.on('connection', () => {
      this.ctx.latestQR = null;
    });
    channel.on('connected', () => {
      this.ctx.broadcast({ type: 'channelStatus', channel: name, connected: true, statusMessage: null });
      this.ctx.broadcast({ type: 'whatsapp-paired', channel: name });
    });
    channel.on('disconnected', () => {
      const statusMessage = (channel as any).statusMessage || null;
      this.ctx.broadcast({ type: 'channelStatus', channel: name, connected: false, statusMessage });
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
  set mcpStart(fn: (() => Promise<{ url: string }>) | undefined) { this.ctx.mcpStart = fn; }
  set mcpStop(fn: (() => Promise<void>) | undefined) { this.ctx.mcpStop = fn; }
  set mcpStatus(fn: (() => { active: boolean; url: string | null }) | undefined) { this.ctx.mcpStatus = fn; }
  set updateStatus(fn: (() => Promise<any>) | undefined) { this.ctx.updateStatus = fn; }
  set updateTrigger(fn: (() => Promise<any>) | undefined) { this.ctx.updateTrigger = fn; }
  set reloadRouter(fn: (() => void) | undefined) { this.ctx.reloadRouter = fn; }
  setExposeMcp(value: boolean): void { this.ctx.setExposeMcp(value); }
  broadcast(msg: any): void { this.ctx.broadcast(msg); }
  getExpressApp() { return this.app; }

  getPort(): number { return this.port; }

  async start(): Promise<void> {
    const portInUse = await this.isPortInUse(this.port);
    if (portInUse) {
      const result = await this.promptPortConflict(this.port);
      if (result === false) {
        console.log('[api] Exiting — port is in use.');
        process.exit(1);
      }
      if (typeof result === 'number') {
        // User chose a different port
        this.port = result;
      }
      this.httpServer = createServer(this.app);
      this.ctx.wss = new WebSocketServer({ server: this.httpServer });
    }

    if (!this.ctx.apiSecret) {
      console.warn('⚠️  No api_secret configured — dashboard and API endpoints are unprotected. Set api_secret in config.yaml for production use.');
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

  /** Returns true if process was killed, a number for an alternative port, or false to abort. */
  private async promptPortConflict(port: number): Promise<boolean | number> {
    const { execSync } = await import('child_process');

    // Resolve lsof path — macOS keeps it in /usr/sbin which may not be in PATH for background processes
    let lsof = 'lsof';
    try { execSync('which lsof', { encoding: 'utf-8', stdio: 'pipe' }); }
    catch { try { execSync('/usr/sbin/lsof -v', { encoding: 'utf-8', stdio: 'pipe' }); lsof = '/usr/sbin/lsof'; } catch {} }

    let pid: string | undefined;
    try {
      const out = execSync(`${lsof} -ti tcp:${port}`, { encoding: 'utf-8' }).trim();
      pid = out.split('\n')[0];
    } catch {}

    const pidInfo = pid ? ` (PID ${pid})` : '';

    // Detect environments where stdin is unavailable or intercepted:
    // - Not a TTY (piped, CI, etc.)
    // - tsx watch / node --watch: inherits TTY handles so isTTY is true,
    //   but stdin is consumed by the watch runner — readline never receives input.
    const isWatchMode = process.execArgv.some(a => a.includes('--watch'))
      || process.argv.some(a => a === '--watch')
      || !!process.env.TSX_WATCH;
    const autoKill = !process.stdin.isTTY || isWatchMode;

    if (!autoKill) {
      console.error(`\n⚠️  Port ${port} is already in use${pidInfo}.`);
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise<string>((res) => {
        // Timeout: if readline is broken (e.g. stdin intercepted), auto-kill
        const timeout = setTimeout(() => {
          rl.close();
          console.error(`   No response received — auto-killing process on port ${port}...`);
          res('k');
        }, 10000);
        rl.question(`   [K]ill the existing process, [C]hange port, or [Q]uit? (auto-kill in 10s) `, (ans) => {
          clearTimeout(timeout);
          rl.close();
          res(ans.trim().toLowerCase());
        });
      });

      if (answer === 'c' || answer === 'change') {
        const rl2 = createInterface({ input: process.stdin, output: process.stderr });
        const newPortStr = await new Promise<string>((res) => {
          rl2.question(`   Enter new port: `, (ans) => {
            rl2.close();
            res(ans.trim());
          });
        });
        const newPort = parseInt(newPortStr, 10);
        if (!newPort || newPort < 1 || newPort > 65535) {
          console.error(`   Invalid port number.`);
          return false;
        }
        if (await this.isPortInUse(newPort)) {
          console.error(`   Port ${newPort} is also in use.`);
          return false;
        }
        console.log(`   Switching to port ${newPort}.`);
        return newPort;
      }

      if (answer !== 'k' && answer !== 'kill' && answer !== 'y' && answer !== 'yes') return false;
    } else {
      console.error(`\n⚠️  Port ${port} is already in use${pidInfo}. Auto-killing...`);
    }

    try {
      try {
        execSync(`${lsof} -ti tcp:${port} | xargs kill -9 2>/dev/null`, { encoding: 'utf-8' });
      } catch {}
      console.log(`   Killed process on port ${port}. Waiting for port to be released...`);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (!(await this.isPortInUse(port))) return true;
        try {
          execSync(`${lsof} -ti tcp:${port} | xargs kill -9 2>/dev/null`, { encoding: 'utf-8' });
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
