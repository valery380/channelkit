import { AuthConfig } from '../config/types';
import { Channel } from '../channels/base';
import { AuthSessionStore, AuthSession } from './sessions';
import { AuthHandler } from './handler';
import { UnifiedMessage } from '../core/types';

export interface CreateSessionResult {
  sessionId: string;
  code: string;
  link?: string;
  expiresAt: number;
}

export class AuthModule {
  private sessions: AuthSessionStore;
  private handler: AuthHandler;

  constructor(
    private config: AuthConfig,
    private channels: Map<string, Channel>,
  ) {
    const ttl = config.session_ttl ?? 300;
    this.sessions = new AuthSessionStore(ttl);
    this.handler = new AuthHandler(this.sessions, config);
  }

  /**
   * Try to intercept an incoming message as an auth code.
   * Called by messageHandler before normal routing.
   */
  tryIntercept(message: UnifiedMessage): boolean {
    return this.handler.tryIntercept(message);
  }

  /**
   * Create a new auth session.
   * For method "code": sends a WhatsApp message to the phone asking user to reply with the code.
   * For method "qr": generates a wa.me link with pre-filled code.
   */
  async createSession(method: 'code' | 'qr', phone?: string): Promise<CreateSessionResult> {
    if (method === 'code' && !phone) {
      throw new Error('Phone number is required for code method');
    }

    // Per-phone rate limiting for outbound messages
    if (method === 'code' && phone && this.sessions.isPhoneThrottled(phone)) {
      throw new Error('A verification message was recently sent to this number. Please wait before trying again.');
    }

    const codeLength = this.config.code_length ?? 6;
    const qrCodeLength = this.config.qr_code_length ?? 8;
    const session = this.sessions.create(method, phone, codeLength, qrCodeLength);

    if (method === 'code') {
      // Send WhatsApp message asking user to reply with the code
      await this.sendVerifyMessage(phone!);
      this.sessions.recordPhoneSend(phone!);
    }

    const result: CreateSessionResult = {
      sessionId: session.id,
      code: session.code,
      expiresAt: session.expiresAt,
    };

    // For QR method, generate the wa.me link
    if (method === 'qr') {
      const waNumber = this.getChannelNumber();
      if (waNumber) {
        const digits = waNumber.replace(/[^0-9]/g, '');
        result.link = `https://wa.me/${digits}?text=${encodeURIComponent(`LOGIN-${session.code}`)}`;
      }
    }

    console.log(`[auth] Session ${session.id} created (${method})${phone ? ` for ${phone}` : ''}`);
    return result;
  }

  /**
   * Get session status.
   */
  getSession(id: string): AuthSession | null {
    return this.sessions.get(id);
  }

  /**
   * Cancel a session.
   */
  cancelSession(id: string): boolean {
    return this.sessions.cancel(id);
  }

  stop(): void {
    this.sessions.stop();
  }

  private async sendVerifyMessage(phone: string): Promise<void> {
    const channelName = this.config.channel;
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Auth channel "${channelName}" not found`);
    }
    if (!channel.connected) {
      throw new Error(`Auth channel "${channelName}" is not connected`);
    }

    const message = this.config.messages?.verify_request
      ?? 'Reply with the code shown on your screen to verify your identity.';

    // Normalize phone to WhatsApp JID format
    const jid = this.phoneToJid(phone);
    await channel.send(jid, { text: message });
  }

  private getChannelNumber(): string | undefined {
    // Try to get the number from the channel config
    // The auth config references a channel name, look up its config
    // We can't directly access the config here, so we get it from the channel
    const channelName = this.config.channel;
    const channel = this.channels.get(channelName);
    if (!channel) return undefined;

    // WhatsApp channels store the number in their config
    return (channel as any).config?.number || this.config.channel_number;
  }

  /** Convert a phone number to WhatsApp JID format */
  private phoneToJid(phone: string): string {
    const digits = phone.replace(/[^0-9]/g, '');
    return `${digits}@s.whatsapp.net`;
  }
}

export { AuthSession } from './sessions';
export { AuthCallbackPayload } from './handler';
