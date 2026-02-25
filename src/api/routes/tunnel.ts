import { Express } from 'express';
import { ServerContext } from '../types';
import { loadConfig, saveConfig } from '../../config/parser';

export function registerTunnelRoutes(app: Express, ctx: ServerContext): void {
  app.get('/api/tunnel/status', (_req, res) => {
    if (!ctx.tunnelStatus) {
      res.json({ active: false, url: null });
      return;
    }
    res.json(ctx.tunnelStatus());
  });

  app.post('/api/tunnel/start', async (_req, res) => {
    if (!ctx.tunnelStart) {
      res.status(503).json({ error: 'Tunnel not available' });
      return;
    }
    try {
      const result = await ctx.tunnelStart();
      // Persist auto_start state
      if (ctx.configPath) {
        try {
          const config = loadConfig(ctx.configPath, { validate: false });
          if (!config.tunnel) config.tunnel = {};
          config.tunnel.auto_start = true;
          saveConfig(ctx.configPath, config);
        } catch {}
      }
      ctx.broadcast({ type: 'tunnelStatus', active: true, url: result.url });
      res.json({ ok: true, url: result.url });
    } catch (err: any) {
      ctx.broadcast({ type: 'tunnelStatus', active: false, url: null, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tunnel/stop', async (_req, res) => {
    if (!ctx.tunnelStop) {
      res.status(503).json({ error: 'Tunnel not available' });
      return;
    }
    try {
      await ctx.tunnelStop();
      // Persist auto_start state
      if (ctx.configPath) {
        try {
          const config = loadConfig(ctx.configPath, { validate: false });
          if (!config.tunnel) config.tunnel = {};
          config.tunnel.auto_start = false;
          saveConfig(ctx.configPath, config);
        } catch {}
      }
      ctx.broadcast({ type: 'tunnelStatus', active: false, url: null });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/tunnel/config', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { token, public_url } = req.body;
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.tunnel) config.tunnel = {};
      if (token) { config.tunnel.token = token; } else { delete config.tunnel.token; }
      if (public_url) { config.tunnel.public_url = public_url; } else { delete config.tunnel.public_url; }
      if (!config.tunnel.provider) config.tunnel.provider = 'cloudflared';
      saveConfig(ctx.configPath, config);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tunnel/config', (_req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      res.json({
        token: config.tunnel?.token || null,
        public_url: config.tunnel?.public_url || null,
        expose_dashboard: ctx.exposeDashboard,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tunnel/update-webhooks', async (_req, res) => {
    if (!ctx.publicUrl) {
      res.status(400).json({ error: 'No public URL — externalize first' });
      return;
    }
    if (!ctx.configPath) {
      res.status(503).json({ error: 'Config path not set' });
      return;
    }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const updated: string[] = [];
      const errors: Array<{ name: string; error: string }> = [];

      for (const [name, ch] of Object.entries(config.channels)) {
        if (ch.type !== 'sms') continue;
        if ((ch as any).poll_interval) continue;
        try {
          const Twilio = (await import('twilio')).default;
          const client = Twilio((ch as any).account_sid as string, (ch as any).auth_token as string);
          const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: (ch as any).number as string, limit: 1 });
          if (numbers.length > 0) {
            const webhookUrl = `${ctx.publicUrl}/inbound/twilio/${name}`;
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

  app.put('/api/tunnel/expose-dashboard', (req, res) => {
    const { enabled } = req.body;
    ctx.setExposeDashboard(!!enabled);
    if (ctx.configPath) {
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.tunnel) config.tunnel = {};
        config.tunnel.expose_dashboard = ctx.exposeDashboard;
        saveConfig(ctx.configPath, config);
      } catch {}
    }
    ctx.broadcast({ type: 'tunnelStatus', active: !!ctx.publicUrl, url: ctx.publicUrl, exposeDashboard: ctx.exposeDashboard });
    res.json({ ok: true, expose_dashboard: ctx.exposeDashboard });
  });
}
