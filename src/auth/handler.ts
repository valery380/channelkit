import { UnifiedMessage } from '../core/types';
import { AuthSessionStore, AuthSession } from './sessions';
import { AuthConfig } from '../config/types';
import { ServiceAuthConfig } from '../config/types';

export interface AuthCallbackPayload {
  sessionId: string;
  phone: string;
  senderName?: string;
  method: 'code' | 'qr';
  verifiedAt: string;
}

export type SendReplyFn = (jid: string, text: string) => Promise<void>;

function buildAuthHeaders(auth?: ServiceAuthConfig): Record<string, string> {
  if (!auth) return {};
  if (auth.type === 'bearer' && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === 'header' && auth.header_name && auth.header_value) {
    return { [auth.header_name]: auth.header_value };
  }
  return {};
}

export class AuthHandler {
  constructor(
    private sessions: AuthSessionStore,
    private config: AuthConfig,
    private sendReply?: SendReplyFn,
  ) {}

  /**
   * Try to intercept an incoming message as an auth code reply.
   * Returns true if the message was consumed by the auth module.
   */
  tryIntercept(message: UnifiedMessage): boolean {
    // Only intercept WhatsApp text messages
    if (message.channel !== 'whatsapp') return false;
    if (!message.text) return false;
    // Only intercept DMs, not group messages
    if (message.groupId) return false;

    const session = this.sessions.matchCode(message.from, message.text);
    if (session) {
      // Mark as verified
      this.sessions.verify(session, message.from, message.senderName);

      // Send success reply if configured
      const successMsg = this.config.messages?.verify_success;
      if (successMsg && this.sendReply) {
        this.sendReply(message.from, successMsg).catch((err) => {
          console.error(`[auth] Failed to send success reply: ${err.message}`);
        });
      }

      // Fire callback asynchronously (don't block message processing)
      this.fireCallback(session).catch((err) => {
        console.error(`[auth] Callback failed for session ${session.id}: ${err.message}`);
      });

      console.log(`[auth] Session ${session.id} verified (${session.method}) for ${session.verifiedPhone}`);
      return true;
    }

    // No match — check if this looks like a failed auth attempt
    if (this.isAuthAttempt(message.from, message.text)) {
      const errorMsg = this.config.messages?.verify_error;
      if (errorMsg && this.sendReply) {
        this.sendReply(message.from, errorMsg).catch((err) => {
          console.error(`[auth] Failed to send error reply: ${err.message}`);
        });
      }
      console.log(`[auth] Failed auth attempt from ${message.from}`);
      return true; // consume the message so it doesn't route to services
    }

    return false;
  }

  /**
   * Check if a message looks like a failed auth attempt.
   * - Phone has a pending code session but sent wrong code
   * - Message starts with LOGIN- but code doesn't match any QR session
   */
  private isAuthAttempt(from: string, text: string): boolean {
    // Check if this phone has a pending code session (wrong code for phone flow)
    if (this.sessions.hasPendingSessionForPhone(from)) {
      return true;
    }

    // Check if message contains a LOGIN- code (QR auth attempt, possibly with prefix text)
    if (this.sessions.hasLoginPrefix(text)) {
      return true;
    }

    return false;
  }

  private async fireCallback(session: AuthSession): Promise<void> {
    const { callback_url, callback_auth } = this.config;
    if (!callback_url) return;

    const payload: AuthCallbackPayload = {
      sessionId: session.id,
      phone: session.verifiedPhone!,
      senderName: session.senderName,
      method: session.method,
      verifiedAt: new Date().toISOString(),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(callback_auth),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(callback_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[auth] Callback returned ${res.status}: ${body.slice(0, 200)}`);
      } else {
        console.log(`[auth] Callback sent for session ${session.id}`);
      }
    } catch (err: any) {
      clearTimeout(timer);
      throw err;
    }
  }
}
