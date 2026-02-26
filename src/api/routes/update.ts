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
      res.status(500).json({ error: err.message });
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
          previousCommit: result.previousCommit,
          newCommit: result.newCommit,
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
