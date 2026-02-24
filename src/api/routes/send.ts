import { Express } from 'express';
import { ServerContext } from '../types';
import { apiSecretCheck } from '../middleware/auth';

export function registerSendRoutes(app: Express, ctx: ServerContext): void {
  app.post('/api/send/:channel/:jid', apiSecretCheck(ctx), async (req: any, res: any) => {
    const { channel: channelName, jid } = req.params;
    const { text, media } = req.body;

    const channel = ctx.channels.get(channelName);
    if (!channel) {
      res.status(404).json({ error: `Channel "${channelName}" not found` });
      return;
    }

    if (!text && !media) {
      res.status(400).json({ error: 'Must provide "text" and/or "media"' });
      return;
    }

    const start = Date.now();
    try {
      await channel.send(decodeURIComponent(jid), { text, media });
      console.log(`[api] Sent async message via ${channelName} to ${jid}`);

      if (ctx.logger) {
        ctx.logger.log({
          id: `async_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Math.floor(Date.now() / 1000),
          channel: channelName,
          from: 'system (async)',
          senderName: 'Async API',
          text: text || '(media)',
          type: 'async-outbound',
          route: `/api/send/${channelName}/${jid}`,
          responseText: undefined,
          status: 'success',
          latency: Date.now() - start,
        });
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error(`[api] Failed to send:`, err);

      if (ctx.logger) {
        ctx.logger.log({
          id: `async_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Math.floor(Date.now() / 1000),
          channel: channelName,
          from: 'system (async)',
          senderName: 'Async API',
          text: text || '(media)',
          type: 'async-outbound',
          route: `/api/send/${channelName}/${jid}`,
          responseText: err.message,
          status: 'error',
          latency: Date.now() - start,
        });
      }

      res.status(500).json({ error: err.message });
    }
  });
}
