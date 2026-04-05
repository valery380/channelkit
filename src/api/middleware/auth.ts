import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { ServerContext } from '../types';

function isMcpPath(p: string): boolean {
  return p === '/mcp' || p.startsWith('/mcp/') || p === '/sse' || p === '/messages';
}

/** Timing-safe string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Set CORS headers and handle OPTIONS preflight for MCP endpoints. */
export function mcpCors(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isMcpPath(req.path)) { next(); return; }
    const origin = ctx.publicUrl || req.headers.origin || '';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function externalAccessGuard(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ctx.publicUrl || ctx.exposeDashboard) { next(); return; }
    const isExternal = req.headers['cf-connecting-ip'] ||
      (req.headers.host && !req.headers.host.includes('localhost') && !req.headers.host.includes('127.0.0.1'));
    if (!isExternal) { next(); return; }
    const p = req.path;
    if (p.startsWith('/inbound/') || p.startsWith('/api/send/') || p === '/api/health') {
      next(); return;
    }
    if (ctx.exposeMcp && isMcpPath(p)) {
      next(); return;
    }
    res.status(403).send('Dashboard access is disabled for external requests.');
  };
}

export function mcpAuthCheck(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isMcpPath(req.path)) { next(); return; }
    if (!ctx.mcpSecret) { next(); return; }
    // Skip auth for local connections — secret is only enforced for external/tunnel access
    const host = req.headers.host || '';
    if (host.includes('localhost') || host.includes('127.0.0.1')) { next(); return; }
    const auth = req.headers.authorization;
    if (auth && safeEqual(auth, `Bearer ${ctx.mcpSecret}`)) {
      next(); return;
    }
    res.status(401).json({ error: 'MCP access requires Authorization: Bearer <secret>' });
  };
}

export function apiSecretCheck(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ctx.apiSecret) { next(); return; }
    const p = req.path;
    if (p.startsWith('/inbound/') || p.startsWith('/api/send/') || p === '/api/health') {
      next(); return;
    }
    const auth = req.headers.authorization;
    if (!auth || !safeEqual(auth, `Bearer ${ctx.apiSecret}`)) {
      res.status(401).json({ error: 'Invalid or missing Authorization header' });
      return;
    }
    next();
  };
}

/**
 * Admin auth guard — protects all dashboard/admin API endpoints.
 * Uses the same api_secret from config. Skips auth when api_secret is not set.
 * Allows through: /inbound/*, /api/health, /qr, /dashboard (static), MCP paths, and /api/auth/check.
 */
export function adminAuthCheck(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ctx.apiSecret) { next(); return; }
    const p = req.path;
    // Allow inbound webhooks, health check, static dashboard assets, QR page, and auth check
    if (p.startsWith('/inbound/') || p.startsWith('/api/send/') || p === '/api/health' || p === '/api/auth/check'
        || p === '/qr' || p === '/dashboard' || p.startsWith('/dashboard/')) {
      next(); return;
    }
    // MCP paths have their own auth
    if (isMcpPath(p)) { next(); return; }
    const auth = req.headers.authorization;
    if (!auth || !safeEqual(auth, `Bearer ${ctx.apiSecret}`)) {
      res.status(401).json({ error: 'Invalid or missing Authorization header' });
      return;
    }
    next();
  };
}
