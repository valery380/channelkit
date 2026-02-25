import { Express } from 'express';
import { ServerContext } from '../types';

export function registerLogRoutes(app: Express, ctx: ServerContext): void {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', channels: [...ctx.channels.keys()] });
  });

  app.get('/api/logs', (req, res) => {
    if (!ctx.logger) {
      res.json([]);
      return;
    }
    const { limit, channel, search } = req.query as Record<string, string>;
    const results = ctx.logger.search({
      limit: limit ? parseInt(limit) : undefined,
      channel: channel || undefined,
      search: search || undefined,
    });
    res.json(results);
  });

  app.get('/api/logs/stats', (_req, res) => {
    if (!ctx.logger) {
      res.json({ total: 0, byChannel: {}, avgLatency: 0, uptime: 0, channels: [] });
      return;
    }
    const stats = ctx.logger.getStats();
    res.json({
      ...stats,
      uptime: Date.now() - ctx.startTime,
      channels: [...ctx.channels.keys()],
    });
  });

  app.delete('/api/logs', (_req, res) => {
    if (!ctx.logger) { res.json({ ok: true }); return; }
    ctx.logger.clear();
    res.json({ ok: true });
  });

  app.get('/api/server-logs', (_req, res) => {
    res.json(ctx.serverLogBuffer);
  });

  app.delete('/api/server-logs', (_req, res) => {
    ctx.serverLogBuffer.length = 0;
    res.json({ ok: true });
  });
}
