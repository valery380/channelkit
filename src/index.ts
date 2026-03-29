import { randomBytes } from 'crypto';
import { AppConfig, TunnelConfig } from './config/types';
import { Router } from './core/router';
import { ApiServer } from './api/server';
import { Channel } from './channels/base';
import { WhatsAppChannel, isBaileysAvailable } from './channels/whatsapp';
import { TelegramChannel } from './channels/telegram';
import { GmailChannel, ResendChannel } from './channels/email';
import { TwilioSMSChannel } from './channels/sms';
import { TwilioVoiceChannel } from './channels/voice';
import { EndpointChannel } from './channels/endpoint';
import { Onboarding } from './onboarding';
import { Logger } from './core/logger';
import { wireMessageHandler } from './core/messageHandler';
import { TunnelManager } from './core/tunnel';
import { loadConfig, saveConfig } from './config/parser';
import { ChannelKitMcpServer } from './mcp';
import { Updater } from './core/updater';
import { setAllowLocalWebhooks } from './core/webhook';

export class ChannelKit {
  private channels: Channel[] = [];
  private channelMap: Map<string, Channel> = new Map();
  private router: Router;
  private apiServer: ApiServer;
  private logger: Logger;
  private onboarding?: Onboarding;
  private tunnel?: TunnelManager;
  private tunnelStartedBy: 'cli' | 'dashboard' | null = null;
  private mcpServer?: ChannelKitMcpServer;
  private updater?: Updater;

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
        anthropic_api_key: 'ANTHROPIC_API_KEY',
      };
      for (const [key, envVar] of Object.entries(map)) {
        const val = (config.settings as any)[key];
        if (val && !process.env[envVar]) {
          process.env[envVar] = val;
        }
      }
    }

    if (config.settings?.allow_local_webhooks) {
      setAllowLocalWebhooks(true);
    }

    this.router = new Router(config.services, config.routes, config.channels);
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
          if (!isBaileysAvailable()) {
            console.warn(`[channelkit] Skipping WhatsApp channel "${name}" — @whiskeysockets/baileys is not installed.`);
            console.warn(`[channelkit] Install it with: npm install -g @whiskeysockets/baileys (global) or npm install @whiskeysockets/baileys (local)`);
            continue;
          }
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
        case 'endpoint': {
          channel = new EndpointChannel(name, channelConfig as any);
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
    const handlerDeps = {
      router: this.router,
      apiServer: this.apiServer,
      logger: this.logger,
      onboarding: this.onboarding,
      config: this.config,
    };
    for (const channel of this.channels) {
      wireMessageHandler(channel, handlerDeps);
    }

    // Wire up voice config lookup for API server
    this.apiServer.findVoiceConfig = (channelName: string) => {
      if (!this.config.services) return undefined;
      const svc = Object.values(this.config.services).find(s => s.channel === channelName);
      return svc?.voice;
    };

    // Auto-generate api_secret on first startup if not configured
    if (!this.config.api_secret && this.configPath) {
      const generated = randomBytes(32).toString('base64url');
      this.config.api_secret = generated;
      try {
        saveConfig(this.configPath, this.config);
        console.log(`\n🔐 New API secret generated and saved to config.yaml:`);
        console.log(`   ${generated}`);
        console.log(`   Use this to log in to the dashboard and for API requests.\n`);
      } catch (err: any) {
        console.warn(`[security] Failed to save generated api_secret: ${err.message}`);
        console.log(`🔐 Generated API secret (not persisted): ${generated}`);
      }
    }

    if (this.config.api_secret) {
      this.apiServer.setApiSecret(this.config.api_secret);
    } else {
      console.warn('[security] No api_secret configured — dashboard and API endpoints are unauthenticated.');
    }
    if (this.config.mcp?.secret) {
      this.apiServer.setMcpSecret(this.config.mcp.secret);
    }

    // Start API server + connect all channels
    await this.apiServer.start();

    // If the port changed (user chose a different port due to conflict), save it
    const actualPort = this.apiServer.getPort();
    if (actualPort !== (this.config.apiPort || 4000) && this.configPath) {
      this.config.apiPort = actualPort;
      try {
        saveConfig(this.configPath, this.config);
        console.log(`[config] Port ${actualPort} saved to config.yaml`);
      } catch (err: any) {
        console.warn(`[config] Failed to save new port: ${err.message}`);
      }
    }

    if (this.configPath) {
      this.apiServer.setConfigPath(this.configPath);
    }
    this.apiServer.captureConsole();

    // Wire up hot-reload: when services are changed via dashboard, reload the Router
    this.apiServer.reloadRouter = () => {
      if (!this.configPath) return;
      try {
        const freshConfig = loadConfig(this.configPath, { validate: false });
        if (freshConfig.services) {
          this.router.reloadServices(freshConfig.services, freshConfig.channels);
          console.log('[router] Services reloaded from config');
        }
      } catch (err: any) {
        console.error(`[router] Failed to reload services: ${err.message}`);
      }
    };

    // Set initial external access from config
    if (this.config.tunnel?.expose_dashboard) {
      this.apiServer.setExposeDashboard(true);
    }
    if (this.config.mcp?.expose) {
      this.apiServer.setExposeMcp(true);
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

    // Wire up MCP callbacks for dashboard control
    const apiPort = this.config.apiPort || 4000;
    this.apiServer.mcpStatus = () => ({
      active: this.mcpServer != null,
      url: this.mcpServer ? `http://localhost:${apiPort}/mcp` : null,
    });

    this.apiServer.mcpStart = async () => {
      if (this.mcpServer) {
        return { url: `http://localhost:${apiPort}/mcp` };
      }
      const mcpCtx = {
        channels: this.channelMap,
        logger: this.logger,
        configPath: this.configPath,
        config: this.config,
        startTime: Date.now(),
        getPublicUrl: () => this.tunnel?.getPublicUrl() || null,
        updater: this.updater,
      };
      this.mcpServer = new ChannelKitMcpServer(mcpCtx, this.config.mcp || {});
      await this.mcpServer.mountOnExpress(this.apiServer.getExpressApp());
      this.apiServer.setExposeMcp(true);
      return { url: `http://localhost:${apiPort}/mcp` };
    };

    this.apiServer.mcpStop = async () => {
      if (this.mcpServer) {
        await this.mcpServer.stop();
        this.mcpServer = undefined;
        this.apiServer.setExposeMcp(false);
      }
    };

    // Start tunnel if configured and auto_start not explicitly disabled
    if (this.config.tunnel && this.config.tunnel.auto_start !== false) {
      const port = this.config.apiPort || 4000;
      this.tunnel = new TunnelManager(this.config.tunnel, port);
      try {
        await this.tunnel.start();
        const publicUrl = this.tunnel.getPublicUrl();
        if (publicUrl) {
          this.apiServer.setPublicUrl(publicUrl);
          this.tunnelStartedBy = 'cli';
          await this.autoConfigureWebhooks(publicUrl);
          // Broadcast so any already-connected dashboard gets the updated state
          this.apiServer.broadcast({
            type: 'tunnelStatus',
            active: true,
            url: publicUrl,
            exposeDashboard: !!this.config.tunnel?.expose_dashboard,
          });
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

    // Initialize updater
    this.updater = new Updater(this.channelMap);

    // Wire up update callbacks for API server
    this.apiServer.updateStatus = async () => {
      return await this.updater!.checkForUpdate();
    };
    this.apiServer.updateTrigger = async () => {
      return await this.updater!.performUpdate();
    };

    // Start auto-update (enabled by default, but npx always uses notify-only)
    const isNpx = this.updater.getMode() === 'npx';
    if (!isNpx && this.config.auto_update?.enabled !== false) {
      const interval = this.config.auto_update?.interval || 30;
      this.updater.startAutoUpdate(interval);
    } else {
      // Auto-update disabled or npx — still check for updates periodically (every 12h) and notify
      this.updater.startUpdateCheck(720);
    }

    // Start MCP server if enabled
    if (this.config.mcp?.enabled) {
      const mcpCtx = {
        channels: this.channelMap,
        logger: this.logger,
        configPath: this.configPath,
        config: this.config,
        startTime: Date.now(),
        getPublicUrl: () => this.tunnel?.getPublicUrl() || null,
        updater: this.updater,
      };
      this.mcpServer = new ChannelKitMcpServer(mcpCtx, this.config.mcp);

      if (this.config.mcp.stdio) {
        // stdio transport — for subprocess usage
        this.mcpServer.startStdio().catch((err) => {
          console.error(`[mcp] Stdio transport failed: ${err.message}`);
        });
      } else {
        // Mount on main Express app (shares port with API server + tunnel)
        await this.mcpServer.mountOnExpress(this.apiServer.getExpressApp());
        // Respect the mcp.expose config (already set earlier at line ~211, but ensure it's set)
        if (this.config.mcp?.expose) {
          this.apiServer.setExposeMcp(true);
        }
        const publicUrl = this.tunnel?.getPublicUrl();
        if (publicUrl) {
          console.log(`[mcp] MCP available at ${publicUrl}/mcp (via tunnel)`);
        }
        // Broadcast so any already-connected dashboard gets the updated state
        this.apiServer.broadcast({
          type: 'mcpStatus',
          active: true,
          url: `http://localhost:${apiPort}/mcp`,
          exposeMcp: !!this.config.mcp?.expose,
          hasSecret: !!this.config.mcp?.secret,
        });
      }
    }
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

      // Auto-configure Resend inbound webhook
      if (channelConfig.type === 'email' && (channelConfig as any).provider === 'resend' && !(channelConfig as any).poll_interval) {
        try {
          const apiKey = (channelConfig as any).api_key as string;
          const webhookUrl = `${publicUrl}/inbound/resend/${name}`;

          // Check if a webhook already points to our endpoint
          const listRes = await fetch('https://api.resend.com/webhooks', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          let existingId: string | null = null;
          if (listRes.ok) {
            const list = await listRes.json() as { data?: { id: string; endpoint: string }[] };
            const match = list.data?.find((w) => w.endpoint === webhookUrl);
            if (match) existingId = match.id;
          }

          if (!existingId) {
            // Register new webhook
            const createRes = await fetch('https://api.resend.com/webhooks', {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: webhookUrl, events: ['email.received'] }),
            });
            if (createRes.ok) {
              const result = await createRes.json() as { id: string; signing_secret?: string };
              (channelConfig as any).webhook_id = result.id;
              if (result.signing_secret) (channelConfig as any).webhook_secret = result.signing_secret;
              if (this.configPath) saveConfig(this.configPath, this.config);
              console.log(`📬 Registered Resend inbound webhook for "${name}" → ${webhookUrl}`);
            } else {
              console.error(`[resend] Failed to register webhook: ${await createRes.text()}`);
              console.log(`📬 Resend inbound webhook (manual): ${webhookUrl}`);
            }
          } else {
            // Already registered — store the ID if missing
            if (!(channelConfig as any).webhook_id) {
              (channelConfig as any).webhook_id = existingId;
              if (this.configPath) saveConfig(this.configPath, this.config);
            }
            console.log(`📬 Resend inbound webhook already registered for "${name}" → ${webhookUrl}`);
          }
        } catch (err: any) {
          console.error(`[tunnel] Failed to register Resend webhook for ${name}: ${err.message}`);
        }
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
    if (this.updater) {
      this.updater.stopAutoUpdate();
    }
    if (this.mcpServer) {
      await this.mcpServer.stop();
    }
    if (this.tunnel) {
      await this.tunnel.stop();
    }
    await this.apiServer.stop();
    await Promise.all(this.channels.map((ch) => ch.disconnect()));
  }
}

export { UnifiedMessage, WebhookResponse } from './core/types';
export { AppConfig } from './config/types';
