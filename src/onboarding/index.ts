import { OnboardingConfig, OnboardingCodeConfig } from '../config/types';
import { WhatsAppChannel } from '../channels/whatsapp';
import { GroupStore } from '../core/groupStore';
import { UnifiedMessage } from '../core/types';

export class Onboarding {
  private groupStore: GroupStore;

  constructor(
    private config: OnboardingConfig,
    private whatsappChannel?: WhatsAppChannel
  ) {
    this.groupStore = new GroupStore();
  }

  getGroupStore(): GroupStore {
    return this.groupStore;
  }

  /**
   * Handle a direct (non-group) message. Returns true if handled by onboarding.
   */
  async handleDirectMessage(message: UnifiedMessage): Promise<boolean> {
    if (!this.whatsappChannel || message.channel !== 'whatsapp') return false;
    if (message.groupId) return false; // only handle DMs

    const codes = this.config.codes || [];
    const text = (message.text || '').trim().toUpperCase();

    const matched = codes.find(c => c.code.toUpperCase() === text);
    if (matched) {
      // Skip if group already exists for this user + service
      const existing = this.groupStore.findByUserAndService(message.from, matched.name);
      if (existing) {
        await this.whatsappChannel.sendToJid(
          message.from,
          `You're already connected to ${matched.name}! Check the group "${matched.name}" in your chats.`
        );
        return true;
      }

      // Skip old messages (older than 30 seconds)
      const now = Math.floor(Date.now() / 1000);
      if (message.timestamp && now - message.timestamp > 30) {
        console.log(`[onboarding] Skipping old message from ${message.from} (${now - message.timestamp}s old)`);
        return true;
      }

      await this.createServiceGroup(message.from, matched);
      return true;
    }

    // No match — send menu
    if (codes.length > 0) {
      const codeList = codes.map(c => c.code).join(' or ');
      await this.whatsappChannel.sendToJid(
        message.from,
        `Available services: send ${codeList} to connect`
      );
    }
    return true; // handled (sent menu)
  }

  private async createServiceGroup(userJid: string, service: OnboardingCodeConfig): Promise<void> {
    if (!this.whatsappChannel) return;

    // Extract user name or phone from JID
    const phone = userJid.replace(/@s\.whatsapp\.net$/, '');
    const userName = phone; // Baileys doesn't give us contact names easily
    const groupName = `${service.name} - ${userName}`;

    try {
      console.log(`[onboarding] Creating group "${groupName}" with participant: ${userJid}`);
      const group = await this.whatsappChannel.createGroup(groupName, [userJid]);

      // Store group→service mapping
      this.groupStore.add(group.id, {
        groupId: group.id,
        serviceName: service.name,
        webhook: service.webhook,
        userId: userJid,
        createdAt: Date.now(),
      });

      // Send welcome message
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
}
