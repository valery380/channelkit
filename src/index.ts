import { AppConfig } from './config/types';
import { Router } from './core/router';
import { ApiServer } from './core/apiServer';
import { Channel } from './channels/base';
import { WhatsAppChannel } from './channels/whatsapp';
import { TelegramChannel } from './channels/telegram';
import { Onboarding } from './onboarding';
import { UnifiedMessage } from './core/types';
import { Logger } from './core/logger';

export class ChannelKit {
  private channels: Channel[] = [];
  private channelMap: Map<string, Channel> = new Map();
  private router: Router;
  private apiServer: ApiServer;
  private logger: Logger;
  private onboarding?: Onboarding;

  constructor(private config: AppConfig) {
    this.router = new Router(config.services, config.routes);
    this.apiServer = new ApiServer(config.apiPort || 4000);
    this.logger = new Logger();

    if (config.dashboard?.enabled !== false) {
      this.router.setLogger(this.logger);
      this.apiServer.setLogger(this.logger);
    }
  }

  async start(): Promise<void> {
    let whatsappChannel: WhatsAppChannel | undefined;
    let telegramChannel: TelegramChannel | undefined;

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
          telegramChannel = channel as TelegramChannel;
          break;
        default:
          console.warn(`Unknown channel type: ${channelConfig.type}`);
          continue;
      }

      this.channels.push(channel);
      this.channelMap.set(name, channel);
      // Register by name for API server
      this.apiServer.registerChannel(name, channel);
      // Also register by type for backward compat
      this.apiServer.registerChannel(channelConfig.type, channel);

      const mode = this.router.getChannelMode(name);
      console.log(`[channelkit] Channel "${name}" (${channelConfig.type}) → ${mode} mode`);
    }

    // Set up Telegram slash commands for multi-service channels
    for (const [name, channel] of this.channelMap.entries()) {
      if (channel instanceof TelegramChannel) {
        const services = this.router.getServicesForChannel(name);
        if (services.length > 1) {
          const svcEntries = Object.entries(this.config.services || {})
            .filter(([_, svc]) => svc.channel === name)
            .map(([svcName, svc]) => ({ name: svcName, config: svc }));
          (channel as TelegramChannel).setSlashCommands(svcEntries);
        }
      }
    }

    // Set up onboarding for channels in groups mode
    // Build onboarding codes from services that have codes
    const onboardingCodes: any[] = [];
    if (this.config.services) {
      for (const [svcName, svc] of Object.entries(this.config.services)) {
        if (svc.code) {
          onboardingCodes.push({
            code: svc.code.toUpperCase(),
            name: svcName,
            webhook: svc.webhook,
            channels: [svc.channel],
          });
        }
      }
    }

    // Also support legacy onboarding config
    if (this.config.onboarding?.codes) {
      onboardingCodes.push(...this.config.onboarding.codes);
    }

    if (onboardingCodes.length > 0) {
      const onboardingConfig = { codes: onboardingCodes };
      this.onboarding = new Onboarding(onboardingConfig, whatsappChannel, telegramChannel);
      this.router.setGroupStore(this.onboarding.getGroupStore());
      console.log(`[channelkit] Onboarding enabled with ${onboardingCodes.length} service code(s)`);
    }

    // Wire up message handlers
    for (const channel of this.channels) {
      channel.on('message', async (message: UnifiedMessage) => {
        // Attach channel name
        message.channelName = channel.name;

        // Try onboarding first for DMs (only in groups mode)
        const mode = this.router.getChannelMode(channel.name);
        if (this.onboarding && !message.groupId && mode === 'groups') {
          const handled = await this.onboarding.handleDirectMessage(message);
          if (handled) {
            this.logger.log({
              id: message.id,
              timestamp: Date.now(),
              channel: message.channel,
              from: message.from,
              senderName: message.senderName,
              text: message.text,
              type: message.type,
              route: 'onboarding',
              status: 'success',
              latency: 0,
            });
            return;
          }

          // Check if Telegram user has a service mapping
          if (message.channel === 'telegram') {
            const webhook = this.onboarding.getTelegramServiceWebhook(message.from);
            if (webhook) {
              const replyTo = message.from;
              const replyUrl = this.apiServer.getReplyUrl(message.channel, replyTo);
              const { dispatchWebhook } = await import('./core/webhook');
              const startTime = Date.now();
              const response = await dispatchWebhook(webhook, message, replyUrl);
              this.logger.log({
                id: message.id,
                timestamp: Date.now(),
                channel: message.channel,
                from: message.from,
                senderName: message.senderName,
                text: message.text,
                type: message.type,
                route: webhook,
                responseText: response?.text,
                status: response ? 'success' : 'error',
                latency: Date.now() - startTime,
              });
              if (response) {
                await channel.send(replyTo, response);
              }
              return;
            }
          }
        }

        const replyTo = message.groupId || message.from;
        const replyUrl = this.apiServer.getReplyUrl(message.channel, replyTo);
        const response = await this.router.route(message, replyUrl);
        if (response) {
          await channel.send(replyTo, response);
        }
      });
    }

    // Start API server + connect all channels
    await this.apiServer.start();
    await Promise.all(this.channels.map((ch) => ch.connect()));
    console.log('Listening for messages...');
  }

  async stop(): Promise<void> {
    await this.apiServer.stop();
    await Promise.all(this.channels.map((ch) => ch.disconnect()));
  }
}

export { UnifiedMessage, WebhookResponse } from './core/types';
export { AppConfig } from './config/types';
