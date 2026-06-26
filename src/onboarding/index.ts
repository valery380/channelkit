import { OnboardingConfig, OnboardingCodeConfig } from '../config/types';
import { WhatsAppChannel } from '../channels/whatsapp';
import { TelegramChannel } from '../channels/telegram';
import { GroupStore } from '../core/groupStore';
import { UnifiedMessage } from '../core/types';

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

  /**
   * Handle a direct message for onboarding. Returns true if handled.
   * @param unmatchedPolicy - what to do when no code matches ('list' = send menu, 'ignore' or undefined = silent)
   */
  async handleDirectMessage(message: UnifiedMessage, unmatchedPolicy?: 'list' | 'ignore'): Promise<boolean> {
    if (message.groupId) return false;

    if (message.channel === 'whatsapp') {
      return this.handleWhatsApp(message, unmatchedPolicy);
    }
    if (message.channel === 'telegram') {
      return this.handleTelegram(message, unmatchedPolicy);
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

  private async handleTelegram(message: UnifiedMessage, unmatchedPolicy?: 'list' | 'ignore'): Promise<boolean> {
    if (!this.telegramChannel) return false;

    const codes = this.getCodesForChannel(message.channelName || message.channel);
    if (codes.length === 0) return false;
    // Support both plain code and /start CODE
    let text = (message.text || '').trim().toUpperCase();
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

    // /start (or bare "start") — always show the welcome menu, regardless of unmatched policy
    if (text === 'START' || text === '/START') {
      await this.telegramChannel.sendToChat(message.from, this.telegramWelcome(codes, connected?.serviceName));
      return true;
    }

    const matched = codes.find(c => c.code.toUpperCase() === text);
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

      await this.telegramChannel.sendToChat(
        message.from,
        `Welcome to ${matched.name}! 🎉\nAll messages here will be forwarded to the service.`
      );

      console.log(`[onboarding] Telegram user ${message.senderName || message.from} connected to ${matched.name}`);
      return true;
    }

    // If already mapped to a service, don't show menu — let it route
    if (connected) {
      return false;
    }

    // No match, no mapping — send menu only if the channel's unmatched policy is 'list'
    if (unmatchedPolicy === 'list' && codes.length > 0) {
      await this.telegramChannel.sendToChat(message.from, this.telegramWelcome(codes));
    }
    return true;
  }

  /** Build the Telegram welcome / service-menu text. */
  private telegramWelcome(codes: OnboardingCodeConfig[], connectedService?: string): string {
    const codeList = codes.map(c => `• ${c.code} → ${c.name}`).join('\n');
    if (connectedService) {
      return `You're connected to ${connectedService}.\n\n` +
        `Send "quit" to disconnect, or send another code to switch:\n${codeList}`;
    }
    return `👋 Welcome!\n\nSend a code to connect to a service:\n${codeList}`;
  }

  // --- Helpers ---

  private getCodesForChannel(channel: string): OnboardingCodeConfig[] {
    return (this.config.codes || []).filter(c => {
      if (!c.channels || c.channels.length === 0) return true; // all channels
      return c.channels.includes(channel);
    });
  }
}
