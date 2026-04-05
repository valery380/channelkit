import { Express } from 'express';
import { randomUUID } from 'crypto';
import { ServerContext } from '../types';
import { apiSecretCheck } from '../middleware/auth';

export function registerSendRoutes(app: Express, ctx: ServerContext): void {
  app.post('/api/send/:channel/:jid', async (req: any, res: any) => {
    const { channel: channelName, jid } = req.params;
    const { text, media, quotedMessageId } = req.body;

    const channel = ctx.channels.get(channelName);
    if (!channel) {
      res.status(404).json({ error: `Channel "${channelName}" not found` });
      return;
    }

    if (!channel.connected) {
      res.status(503).json({ error: `Channel "${channelName}" is not connected` });
      return;
    }

    if (!text && !media) {
      res.status(400).json({ error: 'Must provide "text" and/or "media"' });
      return;
    }

    const start = Date.now();
    try {
      let messageId: string | undefined;
      // Use sendToJid for text-only messages (supports quoting and returns messageId)
      if (text && !media && channel.sendToJid) {
        messageId = await channel.sendToJid(decodeURIComponent(jid), text, quotedMessageId);
      } else {
        await channel.send(decodeURIComponent(jid), { text, media });
      }
      console.log(`[api] Sent async message via ${channelName} to ${jid}${messageId ? ` (id: ${messageId})` : ''}`);

      if (ctx.logger) {
        ctx.logger.log({
          id: randomUUID(),
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

      res.json({ ok: true, messageId });
    } catch (err: any) {
      console.error(`[api] Failed to send:`, err);

      if (ctx.logger) {
        ctx.logger.log({
          id: randomUUID(),
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

      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // React to a message with an emoji
  app.post('/api/react/:channel/:jid', apiSecretCheck(ctx), async (req: any, res: any) => {
    const { channel: channelName, jid } = req.params;
    const { messageId, emoji } = req.body;

    const channel = ctx.channels.get(channelName);
    if (!channel) {
      res.status(404).json({ error: `Channel "${channelName}" not found` });
      return;
    }

    if (!channel.connected) {
      res.status(503).json({ error: `Channel "${channelName}" is not connected` });
      return;
    }

    if (!messageId || !emoji) {
      res.status(400).json({ error: 'Must provide "messageId" and "emoji"' });
      return;
    }

    try {
      if (!channel.reactToMessage) {
        res.status(501).json({ error: `Channel "${channelName}" does not support reactions` });
        return;
      }
      await channel.reactToMessage(decodeURIComponent(jid), messageId, emoji);
      console.log(`[api] Reacted with ${emoji} to ${messageId} via ${channelName}`);
      res.json({ ok: true });
    } catch (err: any) {
      console.error(`[api] Failed to react:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
