import { Express } from 'express';
import { ServerContext } from '../types';
import { loadConfig, saveConfig } from '../../config/parser';

export function registerMcpRoutes(app: Express, ctx: ServerContext): void {
  app.get('/api/mcp/status', (_req, res) => {
    const hasSecret = !!ctx.mcpSecret;
    if (!ctx.mcpStatus) {
      res.json({ active: false, url: null, exposeMcp: ctx.exposeMcp, hasSecret });
      return;
    }
    res.json({ ...ctx.mcpStatus(), exposeMcp: ctx.exposeMcp, hasSecret });
  });

  app.get('/api/mcp/connection-info', (_req, res) => {
    const status = ctx.mcpStatus?.() ?? { active: false, url: null };
    const localUrl = status.url;
    const localSseUrl = localUrl ? localUrl.replace(/\/mcp$/, '/sse') : null;
    const publicUrl = ctx.publicUrl && ctx.exposeMcp ? `${ctx.publicUrl}/mcp` : null;
    const publicSseUrl = ctx.publicUrl && ctx.exposeMcp ? `${ctx.publicUrl}/sse` : null;
    res.json({
      active: status.active,
      localUrl,
      localSseUrl,
      publicUrl,
      publicSseUrl,
      secret: ctx.mcpSecret || null,
      exposeMcp: ctx.exposeMcp,
    });
  });

  app.put('/api/mcp/expose', (req, res) => {
    const { enabled } = req.body;
    ctx.setExposeMcp(!!enabled);
    if (ctx.configPath) {
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.mcp) config.mcp = {};
        config.mcp.expose = !!enabled;
        saveConfig(ctx.configPath, config);
      } catch {}
    }
    ctx.broadcast({ type: 'mcpStatus', active: ctx.mcpStatus?.().active ?? false, url: ctx.mcpStatus?.().url ?? null, exposeMcp: ctx.exposeMcp });
    res.json({ ok: true, expose: ctx.exposeMcp });
  });

  app.post('/api/mcp/start', async (_req, res) => {
    if (!ctx.mcpStart) {
      res.status(503).json({ error: 'MCP not available' });
      return;
    }
    try {
      const result = await ctx.mcpStart();
      // Persist enabled state
      if (ctx.configPath) {
        try {
          const config = loadConfig(ctx.configPath, { validate: false });
          if (!config.mcp) config.mcp = {};
          config.mcp.enabled = true;
          saveConfig(ctx.configPath, config);
        } catch {}
      }
      ctx.broadcast({ type: 'mcpStatus', active: true, url: result.url });
      res.json({ ok: true, url: result.url });
    } catch (err: any) {
      ctx.broadcast({ type: 'mcpStatus', active: false, url: null, error: err.message });
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/mcp/stop', async (_req, res) => {
    if (!ctx.mcpStop) {
      res.status(503).json({ error: 'MCP not available' });
      return;
    }
    try {
      await ctx.mcpStop();
      // Persist disabled state
      if (ctx.configPath) {
        try {
          const config = loadConfig(ctx.configPath, { validate: false });
          if (!config.mcp) config.mcp = {};
          config.mcp.enabled = false;
          saveConfig(ctx.configPath, config);
        } catch {}
      }
      ctx.broadcast({ type: 'mcpStatus', active: false, url: null });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });
}
