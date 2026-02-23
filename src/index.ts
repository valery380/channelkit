import { AppConfig, TunnelConfig } from './config/types';
import { Router } from './core/router';
import { ApiServer } from './core/apiServer';
import { Channel } from './channels/base';
import { WhatsAppChannel } from './channels/whatsapp';
import { TelegramChannel } from './channels/telegram';
import { GmailChannel, ResendChannel } from './channels/email';
import { TwilioSMSChannel } from './channels/sms';
import { TwilioVoiceChannel } from './channels/voice';
import { Onboarding } from './onboarding';
import { UnifiedMessage } from './core/types';
import { Logger } from './core/logger';
import { processInbound, processOutbound } from './media/processor';
import { TunnelManager } from './core/tunnel';
import { loadConfig } from './config/parser';

export class ChannelKit {
  private channels: Channel[] = [];
  private channelMap: Map<string, Channel> = new Map();
  private router: Router;
  private apiServer: ApiServer;
  private logger: Logger;
  private onboarding?: Onboarding;
  private tunnel?: TunnelManager;
  private tunnelStartedBy: 'cli' | 'dashboard' | null = null;

  constructor(private config: AppConfig, private configPath?: string) {
    // Populate process.env from config.settings (existing env vars take precedence)
    if (config.settings) {
      const map: Record<string, string> = {
        twilio_account_sid: 'TWILIO_ACCOUNT_SID',
        twilio_auth_token: 'TWILIO_AUTH_TOKEN',
        google_api_key: 'GOOGLE_API_KEY',
        elevenlabs_api_key: 'ELEVENLABS_API_KEY',
        openai_api_key: 'OPENAI_API_KEY',
        deepgram_api_key: 'DEEPGRAM_API_KEY',
      };
      for (const [key, envVar] of Object.entries(map)) {
        const val = (config.settings as any)[key];
        if (val && !process.env[envVar]) {
          process.env[envVar] = val;
        }
      }
    }

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

    // Detect duplicate Telegram bot tokens before connecting (causes 409 Conflict)
    const telegramTokensSeen = new Map<string, string>(); // token → first channel name
    for (const [name, cfg] of Object.entries(this.config.channels)) {
      if (cfg.type === 'telegram') {
        const token = (cfg as any).bot_token as string;
        if (telegramTokensSeen.has(token)) {
          console.error(
            `[channelkit] ERROR: Channels "${telegramTokensSeen.get(token)}" and "${name}" share the same Telegram bot token. ` +
            `Remove the duplicate from config.yaml or the dashboard before starting.`
          );
          process.exit(1);
        }
        telegramTokensSeen.set(token, name);
      }
    }

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
        case 'email': {
          const emailConfig = channelConfig as any;
          if (emailConfig.provider === 'gmail') {
            channel = new GmailChannel(name, emailConfig);
          } else if (emailConfig.provider === 'resend') {
            channel = new ResendChannel(name, emailConfig);
          } else {
            console.warn(`Unknown email provider: ${emailConfig.provider}`);
            continue;
          }
          break;
        }
        case 'sms': {
          channel = new TwilioSMSChannel(name, channelConfig as any);
          break;
        }
        case 'voice': {
          channel = new TwilioVoiceChannel(name, channelConfig as any);
          break;
        }
        default:
          console.warn(`Unknown channel type: ${channelConfig.type}`);
          continue;
      }

      this.channels.push(channel);
      this.channelMap.set(name, channel);
      // Register by name for API server
      this.apiServer.registerChannel(name, channel);
      // Also register by type for backward compat, but don't overwrite
      // a channel that was registered by its actual name
      if (!this.channelMap.has(channelConfig.type)) {
        this.apiServer.registerChannel(channelConfig.type, channel);
      }

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

        // Try onboarding first for DMs (only in groups mode).
        // Skip if the channel already pre-resolved a webhook (e.g. Telegram slash commands).
        const mode = this.router.getChannelMode(channel.name);
        if (this.onboarding && !message.groupId && mode === 'groups' && !(message as any)._resolvedWebhook) {
          const channelUnmatched = (this.config.channels[channel.name] as any)?.unmatched as 'list' | 'ignore' | undefined;
          const handled = await this.onboarding.handleDirectMessage(message, channelUnmatched);
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

        // STT: transcribe audio if configured for this service
        const serviceConfig = this.router.findServiceConfig(message);
        let sttTranscription: string | undefined;
        if (serviceConfig) {
          const originalText = message.text;
          await processInbound(message, serviceConfig);
          if (message.type === 'audio' && message.text && message.text !== originalText) {
            sttTranscription = message.text;
          }
        }

        const replyTo = message.groupId || message.from;
        const replyUrl = this.apiServer.getReplyUrl(message.channel, replyTo);
        const { response: routedResponse, webhook: routedWebhook, latency } = await this.router.route(message, replyUrl);
        let response = routedResponse;

        // If no service matched, check channel's unmatched policy.
        // Only applies to DMs (no groupId) — group messages imply a pre-existing
        // service mapping that is simply unavailable (e.g. after restart), so
        // sending a service list there would be confusing.
        if (!response && !message.groupId) {
          const channelCfg = this.config.channels[channel.name];
          if (channelCfg?.unmatched === 'list') {
            const svcs = this.router.getNamedServicesForChannel(channel.name);
            if (svcs.length > 0) {
              const lines = svcs.map(({ name, config: svc }) => {
                if (svc.command) {
                  const cmd = svc.command.startsWith('/') ? svc.command : `/${svc.command}`;
                  return `• ${name} — use ${cmd}`;
                }
                if (svc.code) return `• ${name} — send "${svc.code.toUpperCase()}" to connect`;
                return `• ${name}`;
              });
              await channel.send(replyTo, { text: `Available services:\n${lines.join('\n')}` });
            }
          }
        }

        // TTS: convert text to speech when TTS is configured on the service
        let ttsGenerated = false;
        let ttsError: string | undefined;
        if (response && serviceConfig) {
          const hadMedia = response.media;
          const result = await processOutbound(response, serviceConfig);
          response = result.response;
          ttsError = result.ttsError;
          if (!hadMedia && response.media) {
            ttsGenerated = true;
          }
        }

        // Send the response and capture any delivery error
        let sendError: string | undefined;
        if (response) {
          // Voice calls: route response to TwiML redirect flow
          if (message.channel === 'voice' && (message as any)._callSid && channel instanceof TwilioVoiceChannel) {
            channel.setCallResponse((message as any)._callSid, response);
          } else {
            try {
              await channel.send(replyTo, response);
            } catch (sendErr: any) {
              sendError = sendErr?.message || String(sendErr);
              console.error(`[${channel.name}] Failed to send reply to ${replyTo}: ${sendError}`);
            }
          }
        }

        // Build response text for logging, including any errors
        let logResponseText = response?.text;
        if (ttsError) {
          logResponseText = `${logResponseText ? logResponseText + '\n' : ''}[TTS failed: ${ttsError}]`;
        }
        if (sendError) {
          logResponseText = `${logResponseText ? logResponseText + '\n' : ''}[Delivery failed: ${sendError}]`;
        }

        // Single log entry: inbound message + webhook result + delivery outcome
        this.logger.log({
          id: message.id,
          timestamp: Date.now(),
          channel: message.channel,
          from: message.from,
          senderName: message.senderName,
          text: message.text,
          type: message.type,
          groupId: message.groupId,
          groupName: message.groupName,
          route: routedWebhook,
          responseText: logResponseText,
          status: (sendError || ttsError) ? 'error' : (!routedWebhook ? 'no-route' : (response ? 'success' : 'error')),
          latency,
          sttTranscription,
          ttsGenerated: ttsGenerated || undefined,
        });
      });
    }

    // Wire up voice config lookup for API server
    this.apiServer.findVoiceConfig = (channelName: string) => {
      if (!this.config.services) return undefined;
      const svc = Object.values(this.config.services).find(s => s.channel === channelName);
      return svc?.voice;
    };

    // Start API server + connect all channels
    await this.apiServer.start();
    if (this.configPath) {
      this.apiServer.setConfigPath(this.configPath);
    }
    if (this.config.api_secret) {
      this.apiServer.setApiSecret(this.config.api_secret);
    }
    this.apiServer.captureConsole();

    // Set initial dashboard external access from config
    if (this.config.tunnel?.expose_dashboard) {
      this.apiServer.setExposeDashboard(true);
    }

    // Wire up tunnel callbacks for dashboard control
    this.apiServer.tunnelStatus = () => ({
      active: this.tunnel?.getPublicUrl() != null,
      url: this.tunnel?.getPublicUrl() || null,
    });

    this.apiServer.tunnelStart = async () => {
      if (this.tunnel?.getPublicUrl()) {
        return { url: this.tunnel.getPublicUrl()! };
      }
      const port = this.config.apiPort || 4000;
      // Reload config from file to pick up any saved token/hostname
      let tunnelConfig: TunnelConfig = { provider: 'cloudflared' };
      if (this.configPath) {
        try {
          const freshConfig = loadConfig(this.configPath, { validate: false });
          if (freshConfig.tunnel) tunnelConfig = freshConfig.tunnel;
        } catch {}
      }
      this.tunnel = new TunnelManager(tunnelConfig, port);
      await this.tunnel.start();
      const publicUrl = this.tunnel.getPublicUrl();
      if (!publicUrl) throw new Error('Tunnel started but no URL received');
      this.apiServer.setPublicUrl(publicUrl);
      this.tunnelStartedBy = 'dashboard';
      await this.autoConfigureWebhooks(publicUrl);
      return { url: publicUrl };
    };

    this.apiServer.tunnelStop = async () => {
      if (this.tunnel) {
        await this.tunnel.stop();
        this.tunnel = undefined;
        this.apiServer.clearPublicUrl();
        this.tunnelStartedBy = null;
      }
    };

    // Start tunnel if configured
    if (this.config.tunnel) {
      const port = this.config.apiPort || 4000;
      this.tunnel = new TunnelManager(this.config.tunnel, port);
      try {
        await this.tunnel.start();
        const publicUrl = this.tunnel.getPublicUrl();
        if (publicUrl) {
          this.apiServer.setPublicUrl(publicUrl);
          this.tunnelStartedBy = 'cli';
          await this.autoConfigureWebhooks(publicUrl);
        }
      } catch (err: any) {
        console.error(`[tunnel] Failed to start tunnel: ${err.message}`);
      }
    }

    const connectResults = await Promise.allSettled(this.channels.map((ch) => ch.connect()));
    connectResults.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`[channelkit] Failed to connect channel "${this.channels[i].name}": ${result.reason?.message || result.reason}`);
      }
    });
    console.log('Listening for messages...');
  }

  private async autoConfigureWebhooks(publicUrl: string): Promise<void> {
    for (const [name, channelConfig] of Object.entries(this.config.channels)) {
      // Auto-configure Twilio webhook for SMS channels
      if (channelConfig.type === 'sms' || (channelConfig as any).account_sid) {
        try {
          const twilioConfig = channelConfig as any;
          if (twilioConfig.account_sid && twilioConfig.auth_token && twilioConfig.number_sid) {
            const { TwilioProvisioner } = await import('./provisioning/twilio');
            const twilio = new TwilioProvisioner({
              accountSid: twilioConfig.account_sid,
              authToken: twilioConfig.auth_token,
            });
            const webhookUrl = `${publicUrl}/inbound/twilio/${name}`;
            await (twilio as any).client.incomingPhoneNumbers(twilioConfig.number_sid).update({
              smsUrl: webhookUrl,
            });
            console.log(`📱 Updated Twilio webhook for ${twilioConfig.phone_number || name}`);
          }
        } catch (err: any) {
          console.error(`[tunnel] Failed to update Twilio webhook for ${name}: ${err.message}`);
        }
      }

      // Print Resend inbound webhook info
      if (channelConfig.type === 'email' && (channelConfig as any).provider === 'resend') {
        console.log(`📬 Resend inbound webhook: ${publicUrl}/inbound/resend/${name}`);
      }

      // Auto-configure Twilio voice webhook
      if (channelConfig.type === 'voice') {
        const voiceChannel = this.channelMap.get(name);
        if (voiceChannel && voiceChannel instanceof TwilioVoiceChannel) {
          voiceChannel.setPublicUrl(publicUrl);
          const webhookUrl = `${publicUrl}/inbound/voice/${name}`;
          await voiceChannel.setWebhookUrl(webhookUrl);
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.tunnel) {
      await this.tunnel.stop();
    }
    await this.apiServer.stop();
    await Promise.all(this.channels.map((ch) => ch.disconnect()));
  }
}

export { UnifiedMessage, WebhookResponse } from './core/types';
export { AppConfig } from './config/types';
