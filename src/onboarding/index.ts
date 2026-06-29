import { OnboardingConfig, OnboardingCodeConfig, ChannelConfig, SettingsConfig } from '../config/types';
import { WhatsAppChannel } from '../channels/whatsapp';
import { TelegramChannel } from '../channels/telegram';
import { GroupStore } from '../core/groupStore';
import { UnifiedMessage } from '../core/types';

/** Per-message context passed from the message handler into onboarding. */
export interface DirectMessageContext {
  unmatchedPolicy?: 'list' | 'ignore';
  channelConfig?: ChannelConfig;
  settings?: SettingsConfig;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Onboarding {
  private groupStore: GroupStore;

  /** Namespaced GroupStore key for a Telegram chat→service mapping. */
  private tgKey(chatId: string): string {
    return `tg:${chatId}`;
  }

  constructor(
    private config: OnboardingConfig,
    private whatsappChannel?: WhatsAppChannel,
    private telegramChannel?: TelegramChannel,
    groupStore?: GroupStore
  ) {
    this.groupStore = groupStore || new GroupStore();
  }

  getGroupStore(): GroupStore {
    return this.groupStore;
  }

  /** Replace onboarding codes (e.g. after services change via the API) — no restart needed. */
  reloadCodes(codes: OnboardingCodeConfig[]): void {
    this.config = { ...this.config, codes };
  }

  /**
   * Handle a direct message for onboarding. Returns true if handled.
   * @param ctx - per-message context (unmatched policy, channel config, settings)
   */
  async handleDirectMessage(message: UnifiedMessage, ctx: DirectMessageContext = {}): Promise<boolean> {
    if (message.groupId) return false;

    if (message.channel === 'whatsapp') {
      return this.handleWhatsApp(message, ctx.unmatchedPolicy);
    }
    if (message.channel === 'telegram') {
      return this.handleTelegram(message, ctx);
    }
    return false;
  }

  /**
   * Check if a Telegram chat has a service mapping. Returns the webhook URL if so.
   */
  getTelegramServiceWebhook(chatId: string): string | undefined {
    const mapping = this.groupStore.get(this.tgKey(chatId));
    if (!mapping) return undefined;
    // Prefer the current webhook from config (handles config edits),
    // falling back to the one stored at onboarding time.
    const code = (this.config.codes || []).find(c => c.name === mapping.serviceName);
    return code?.webhook || mapping.webhook;
  }

  // --- WhatsApp ---

  private async handleWhatsApp(message: UnifiedMessage, unmatchedPolicy?: 'list' | 'ignore'): Promise<boolean> {
    if (!this.whatsappChannel) return false;

    const codes = this.getCodesForChannel(message.channelName || message.channel);
    const text = (message.text || '').trim().toUpperCase();

    const matched = codes.find(c => c.code.toUpperCase() === text);
    if (matched) {
      const existing = this.groupStore.findByUserAndService(message.from, matched.name);
      if (existing) {
        await this.whatsappChannel.sendToJid(
          message.from,
          `You're already connected to ${matched.name}! Check the group "${matched.name}" in your chats.`
        );
        return true;
      }

      const now = Math.floor(Date.now() / 1000);
      if (message.timestamp && now - message.timestamp > 30) {
        console.log(`[onboarding] Skipping old message from ${message.from} (${now - message.timestamp}s old)`);
        return true;
      }

      await this.createWhatsAppGroup(message.from, matched, message.senderName);
      return true;
    }

    // No match — send menu only if the channel's unmatched policy is 'list'
    if (unmatchedPolicy === 'list' && codes.length > 0) {
      const codeList = codes.map(c => c.code).join(' or ');
      await this.whatsappChannel.sendToJid(
        message.from,
        `Available services: send ${codeList} to connect`
      );
    }
    return true;
  }

  private async createWhatsAppGroup(userJid: string, service: OnboardingCodeConfig, senderName?: string): Promise<void> {
    if (!this.whatsappChannel) return;

    const phone = userJid.replace(/@s\.whatsapp\.net$/, '');
    const groupName = `${service.name} - ${senderName || phone}`;

    try {
      console.log(`[onboarding] Creating group "${groupName}" with participant: ${userJid}`);
      const group = await this.whatsappChannel.createGroup(groupName, [userJid]);

      this.groupStore.add(group.id, {
        groupId: group.id,
        serviceName: service.name,
        webhook: service.webhook,
        userId: userJid,
        createdAt: Date.now(),
      });

      await this.whatsappChannel.sendToJid(
        group.id,
        `Welcome to ${service.name}! 🎉\nAll messages in this group will be forwarded to the service.`
      );

      console.log(`[onboarding] Created group "${groupName}" (${group.id}) for service ${service.name}`);
    } catch (err) {
      console.error(`[onboarding] Failed to create group:`, err);
      await this.whatsappChannel.sendToJid(
        userJid,
        `Sorry, failed to set up ${service.name}. Please try again.`
      );
    }
  }

  // --- Telegram ---

  private async handleTelegram(message: UnifiedMessage, ctx: DirectMessageContext = {}): Promise<boolean> {
    if (!this.telegramChannel) return false;

    const codes = this.getCodesForChannel(message.channelName || message.channel);
    if (codes.length === 0) return false;

    const raw = (message.text || '').trim();
    // Support both plain code and "/start CODE" deep links
    let text = raw.toUpperCase();
    if (text.startsWith('/START ')) {
      text = text.slice(7).trim();
    }

    const connected = this.groupStore.get(this.tgKey(message.from));

    // QUIT — disconnect from the current service, back to the channel
    if (text === 'QUIT' || text === '/QUIT') {
      if (connected) {
        this.groupStore.remove(this.tgKey(message.from));
        await this.telegramChannel.sendToChat(
          message.from,
          `Disconnected from ${connected.serviceName}. Send a code to connect again, or /start to see options.`
        );
        console.log(`[onboarding] Telegram user ${message.senderName || message.from} disconnected from ${connected.serviceName}`);
      } else {
        await this.telegramChannel.sendToChat(
          message.from,
          `You're not connected to any service.`
        );
      }
      return true;
    }

    // /start (or bare "start") — show the configured welcome (webhook → static → default menu)
    if (text === 'START' || text === '/START') {
      const reply = await this.buildStartReply(message, connected?.serviceName, ctx);
      await this.telegramChannel.sendToChat(message.from, reply);
      return true;
    }

    // Resolve which service to connect to: exact code → regex → AI.
    // Exact match works even while connected (lets the user switch services).
    let matched = codes.find(c => c.code.toUpperCase() === text);

    // Regex and AI only run for not-yet-connected users, so they never hijack a
    // connected user's normal messages.
    if (!matched && !connected) {
      // Regex: a code appears as a whole word somewhere in the sentence.
      const regexHits = codes.filter(c => new RegExp(`\\b${escapeRegex(c.code)}\\b`, 'i').test(raw));
      if (regexHits.length === 1) {
        matched = regexHits[0];
      } else if (ctx.channelConfig?.ai_routing) {
        // 0 or multiple regex hits — let AI infer the intended service.
        matched = await this.aiMatchTelegram(raw, codes, ctx);
      }
    }

    if (matched) {
      // Check if already connected
      if (connected?.serviceName === matched.name) {
        await this.telegramChannel.sendToChat(
          message.from,
          `You're already connected to ${matched.name}! Just send messages here.`
        );
        return true;
      }

      // Map this chat to the service (persisted, survives restarts)
      this.groupStore.add(this.tgKey(message.from), {
        groupId: this.tgKey(message.from),
        serviceName: matched.name,
        webhook: matched.webhook,
        userId: message.from,
        createdAt: Date.now(),
      });
      console.log(`[onboarding] Telegram user ${message.senderName || message.from} connected to ${matched.name}`);

      // Connect behavior is configurable per channel (defaults: welcome + forward).
      const connectCfg = ctx.channelConfig?.connect;
      const sendWelcome = connectCfg?.welcome !== false;
      const forwardMessage = connectCfg?.forward !== false;

      if (sendWelcome) {
        await this.telegramChannel.sendToChat(
          message.from,
          `Welcome to ${matched.name}! 🎉\nAll messages here will be forwarded to the service.`
        );
      }

      // Returning false lets the message handler forward this same message to the
      // newly-connected service (via the mapping just stored). Return true to consume it.
      return !forwardMessage;
    }

    // If already mapped to a service, don't show menu — let it route
    if (connected) {
      return false;
    }

    // No match, no mapping — send menu only if the channel's unmatched policy is 'list'
    if (ctx.unmatchedPolicy === 'list' && codes.length > 0) {
      await this.telegramChannel.sendToChat(message.from, this.telegramServiceList(codes));
    }
    return true;
  }

  /** Build the /start reply: configured webhook (dynamic) → static message → default welcome. */
  private async buildStartReply(
    message: UnifiedMessage,
    connectedService: string | undefined,
    ctx: DirectMessageContext,
  ): Promise<string> {
    const startCfg = ctx.channelConfig?.start;
    if (startCfg?.webhook) {
      try {
        const { dispatchWebhook } = await import('../core/webhook');
        const { response } = await dispatchWebhook(startCfg.webhook, message, undefined, { auth: startCfg.auth });
        if (response?.text) return response.text;
      } catch (err: any) {
        console.error(`[onboarding] /start webhook failed: ${err?.message || err}`);
      }
    }
    if (startCfg?.message) return startCfg.message;
    return this.telegramWelcome(connectedService);
  }

  /** Use the AI router to infer which service a free-text message wants to connect to. */
  private async aiMatchTelegram(
    text: string,
    codes: OnboardingCodeConfig[],
    ctx: DirectMessageContext,
  ): Promise<OnboardingCodeConfig | undefined> {
    if (!ctx.channelConfig) return undefined;
    try {
      const { aiRoute } = await import('../core/aiRouter');
      // Fold the connection keyword into the description so the AI can match on it too.
      const services = codes.map(c => ({
        name: c.name,
        webhook: c.webhook,
        description: [c.description, `keyword: ${c.code}`].filter(Boolean).join(' — '),
      }));
      const result = await aiRoute(text, services, ctx.channelConfig, ctx.settings || {});
      if (result.serviceName && result.serviceName.toUpperCase() !== 'NONE') {
        const hit = codes.find(c => c.name === result.serviceName);
        if (hit) console.log(`[onboarding] AI matched "${text}" → ${hit.name}`);
        return hit;
      }
    } catch (err: any) {
      console.error(`[onboarding] AI onboarding match failed: ${err?.message || err}`);
    }
    return undefined;
  }

  /** Default Telegram welcome text. Codes are not listed (they act as access keys). */
  private telegramWelcome(connectedService?: string): string {
    if (connectedService) {
      return `You're connected to ${connectedService}.\n\nSend "quit" to disconnect.`;
    }
    return `👋 Welcome!\n\nSend a code to connect to a service.`;
  }

  /** Explicit service list — only used when a channel's unmatched policy is 'list'. */
  private telegramServiceList(codes: OnboardingCodeConfig[]): string {
    const codeList = codes.map(c => `• ${c.code} → ${c.name}`).join('\n');
    return `Available services:\n${codeList}\n\nSend a code to connect.`;
  }

  // --- Helpers ---

  private getCodesForChannel(channel: string): OnboardingCodeConfig[] {
    return (this.config.codes || []).filter(c => {
      if (!c.channels || c.channels.length === 0) return true; // all channels
      return c.channels.includes(channel);
    });
  }
}
