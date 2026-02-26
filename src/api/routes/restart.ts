import { Express } from 'express';
import { ServerContext } from '../types';
import { restartProcess } from '../../core/restart';

export function registerRestartRoutes(app: Express, ctx: ServerContext): void {
  app.post('/api/restart', (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => restartProcess(ctx.channels), 300);
  });
}
