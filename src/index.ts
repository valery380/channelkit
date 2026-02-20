import { AppConfig } from './config/types';
import { Router } from './core/router';
import { Channel } from './channels/base';
import { WhatsAppChannel } from './channels/whatsapp';
import { TelegramChannel } from './channels/telegram';
import { UnifiedMessage } from './core/types';

export class ChannelKit {
  private channels: Channel[] = [];
  private router: Router;

  constructor(private config: AppConfig) {
    this.router = new Router(config.routes);
  }

  async start(): Promise<void> {
    // Initialize channels
    for (const [name, channelConfig] of Object.entries(this.config.channels)) {
      let channel: Channel;
      switch (channelConfig.type) {
        case 'whatsapp':
          channel = new WhatsAppChannel(name, channelConfig as any);
          break;
        case 'telegram':
          channel = new TelegramChannel(name, channelConfig as any);
          break;
        default:
          console.warn(`Unknown channel type: ${channelConfig.type}`);
          continue;
      }

      channel.on('message', async (message: UnifiedMessage) => {
        const response = await this.router.route(message);
        if (response) {
          const replyTo = message.groupId || message.from;
          await channel.send(replyTo, response);
        }
      });

      this.channels.push(channel);
    }

    // Connect all channels
    await Promise.all(this.channels.map((ch) => ch.connect()));
    console.log('Listening for messages...');
  }

  async stop(): Promise<void> {
    await Promise.all(this.channels.map((ch) => ch.disconnect()));
  }
}

export { UnifiedMessage, WebhookResponse } from './core/types';
export { AppConfig } from './config/types';
