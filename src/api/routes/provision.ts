import { Express } from 'express';
import { ServerContext } from '../types';
import { safeEqual } from '../middleware/auth';
import { createService } from '../services/createService';

/**
 * Scoped provisioning API — reachable externally (e.g. through a tunnel) and
 * guarded by its own `provision_secret`, separate from the admin `api_secret`.
 * It can ONLY create services; it exposes no read/update/delete or channel access.
 */
export function registerProvisionRoutes(app: Express, ctx: ServerContext): void {
  // POST /api/provision/services — create a service (create-only)
  app.post('/api/provision/services', (req, res) => {
    if (!ctx.provisionSecret) {
      res.status(403).json({ error: 'Provisioning API is disabled. Set provision_secret in config to enable it.' });
      return;
    }
    const auth = req.headers.authorization;
    if (!auth || !safeEqual(auth, `Bearer ${ctx.provisionSecret}`)) {
      res.status(401).json({ error: 'Invalid or missing Authorization header' });
      return;
    }
    const { status, body } = createService(ctx, req.body || {});
    res.status(status).json(body);
  });
}
