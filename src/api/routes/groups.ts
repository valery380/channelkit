import { Express } from 'express';
import { ServerContext } from '../types';
import { apiSecretCheck } from '../middleware/auth';
import { WhatsAppChannel } from '../../channels/whatsapp/index';

export function registerGroupRoutes(app: Express, ctx: ServerContext): void {
  /**
   * POST /api/groups/:channel
   * Create a WhatsApp group with optional description, photo, and participants.
   * Returns the group ID and invite link.
   *
   * Body:
   *   name: string              — group name (required)
   *   description?: string      — group description
   *   photo?: string            — base64-encoded image (data URI or raw base64)
   *   participants?: string[]   — JIDs to add (e.g. ["972501234567@s.whatsapp.net"])
   */
  app.post('/api/groups/:channel', apiSecretCheck(ctx), async (req: any, res: any) => {
    const { channel: channelName } = req.params;
    const { name, description, photo, participants } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: '"name" is required' });
      return;
    }

    const channel = ctx.channels.get(channelName);
    if (!channel) {
      res.status(404).json({ error: `Channel "${channelName}" not found` });
      return;
    }

    if (!channel.connected) {
      res.status(503).json({ error: `Channel "${channelName}" is not connected` });
      return;
    }

    if (!(channel instanceof WhatsAppChannel)) {
      res.status(400).json({ error: `Channel "${channelName}" is not a WhatsApp channel` });
      return;
    }

    try {
      // Create the group
      const group = await channel.createGroup(name, participants || []);
      console.log(`[api] Created WhatsApp group "${name}" (${group.id}) on ${channelName}`);

      // Set description if provided
      if (description) {
        await channel.groupUpdateDescription(group.id, description);
      }

      // Set photo if provided (base64 string or data URI)
      if (photo) {
        let imageBuffer: Buffer;
        if (photo.startsWith('data:')) {
          // data:image/jpeg;base64,/9j/4AAQ...
          const base64Data = photo.split(',')[1];
          imageBuffer = Buffer.from(base64Data, 'base64');
        } else {
          imageBuffer = Buffer.from(photo, 'base64');
        }
        await channel.groupUpdatePhoto(group.id, imageBuffer);
      }

      // Get invite link
      const inviteCode = await channel.groupInviteCode(group.id);
      const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

      res.json({
        id: group.id,
        name: group.subject,
        inviteLink,
      });
    } catch (err: any) {
      console.error(`[api] Failed to create group:`, err);
      res.status(500).json({ error: err.message || 'Failed to create group' });
    }
  });
}
