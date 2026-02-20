import { AppConfig } from './config/types';
import { Router } from './core/router';
import { Channel } from './channels/base';
import { WhatsAppChannel } from './channels/whatsapp';
import { TelegramChannel } from './channels/telegram';
import { Onboarding } from './onboarding';
import { UnifiedMessage } from './core/types';

export class ChannelKit {
  private channels: Channel[] = [];
  private router: Router;
  private onboarding?: Onboarding;

  constructor(private config: AppConfig) {
    this.router = new Router(config.routes);
  }

  async start(): Promise<void> {
    let whatsappChannel: WhatsAppChannel | undefined;

    // Initialize channels
    for (const [name, channelConfig] of Object.entries(this.config.channels)) {
      let channel: Channel;
      switch (channelConfig.type) {
        case 'whatsapp':
          channel = new WhatsAppChannel(name, channelConfig as any);
          whatsappChannel = channel as WhatsAppChannel;
          break;
        case 'telegram':
          channel = new TelegramChannel(name, channelConfig as any);
          break;
        default:
          console.warn(`Unknown channel type: ${channelConfig.type}`);
          continue;
      }

      this.channels.push(channel);
    }

    // Set up onboarding if configured
    if (this.config.onboarding?.codes && this.config.onboarding.codes.length > 0) {
      this.onboarding = new Onboarding(this.config.onboarding, whatsappChannel);
      this.router.setGroupStore(this.onboarding.getGroupStore());
      console.log(`[channelkit] Onboarding enabled with ${this.config.onboarding.codes.length} service code(s)`);
    }

    // Wire up message handlers
    for (const channel of this.channels) {
      channel.on('message', async (message: UnifiedMessage) => {
        // Try onboarding first for DMs
        if (this.onboarding && !message.groupId) {
          const handled = await this.onboarding.handleDirectMessage(message);
          if (handled) return;
        }

        const response = await this.router.route(message);
        if (response) {
          const replyTo = message.groupId || message.from;
          await channel.send(replyTo, response);
        }
      });
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
