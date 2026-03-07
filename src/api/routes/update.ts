import { Express } from 'express';
import { ServerContext } from '../types';

export function registerUpdateRoutes(app: Express, ctx: ServerContext): void {
  app.get('/api/update/status', async (_req, res) => {
    if (!ctx.updateStatus) {
      res.status(503).json({ error: 'Update not available' });
      return;
    }
    try {
      const status = await ctx.updateStatus();
      res.json(status);
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/update', async (_req, res) => {
    if (!ctx.updateTrigger) {
      res.status(503).json({ error: 'Update not available' });
      return;
    }
    try {
      const result = await ctx.updateTrigger();
      if (result.success) {
        ctx.broadcast({
          type: 'updateStatus',
          updating: true,
          previousVersion: result.previousVersion,
          newVersion: result.newVersion,
        });
      }
      res.json(result);
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });
}
