import { Express } from 'express';
import { ServerContext } from '../types';
import { apiSecretCheck } from '../middleware/auth';

export function registerAuthRoutes(app: Express, ctx: ServerContext): void {
  // Create auth session
  app.post('/api/auth/session', apiSecretCheck(ctx), async (req: any, res: any) => {
    if (!ctx.authModule) {
      res.status(503).json({ error: 'Auth module is not enabled' });
      return;
    }

    const { method, phone } = req.body;
    if (!method || !['code', 'qr'].includes(method)) {
      res.status(400).json({ error: 'Invalid method. Must be "code" or "qr".' });
      return;
    }
    if (method === 'code' && !phone) {
      res.status(400).json({ error: 'Phone number is required for code method.' });
      return;
    }

    try {
      const result = await ctx.authModule.createSession(method, phone);
      res.json(result);
    } catch (err: any) {
      const status = err.message.includes('recently sent') ? 429 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // Get session status
  app.get('/api/auth/session/:id', apiSecretCheck(ctx), (req: any, res: any) => {
    if (!ctx.authModule) {
      res.status(503).json({ error: 'Auth module is not enabled' });
      return;
    }

    const session = ctx.authModule.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      status: session.status,
      method: session.method,
      phone: session.verifiedPhone || undefined,
      senderName: session.senderName || undefined,
      expiresAt: session.expiresAt,
    });
  });

  // Cancel session
  app.delete('/api/auth/session/:id', apiSecretCheck(ctx), (req: any, res: any) => {
    if (!ctx.authModule) {
      res.status(503).json({ error: 'Auth module is not enabled' });
      return;
    }

    const deleted = ctx.authModule.cancelSession(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ ok: true });
  });
}
