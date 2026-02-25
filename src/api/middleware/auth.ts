import { Request, Response, NextFunction } from 'express';
import { ServerContext } from '../types';

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
    if (ctx.exposeMcp && (p === '/mcp' || p.startsWith('/mcp/') || p === '/sse' || p === '/messages')) {
      next(); return;
    }
    res.status(403).send('Dashboard access is disabled for external requests.');
  };
}

export function mcpAuthCheck(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p !== '/mcp' && !p.startsWith('/mcp/') && p !== '/sse' && p !== '/messages') {
      next(); return;
    }
    if (!ctx.mcpSecret) { next(); return; }
    const auth = req.headers.authorization;
    if (auth && auth === `Bearer ${ctx.mcpSecret}`) {
      next(); return;
    }
    res.status(401).json({ error: 'MCP access requires Authorization: Bearer <secret>' });
  };
}

export function apiSecretCheck(ctx: ServerContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ctx.apiSecret) { next(); return; }
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${ctx.apiSecret}`) {
      res.status(401).json({ error: 'Invalid or missing Authorization header' });
      return;
    }
    next();
  };
}
