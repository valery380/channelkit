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
    if (!session) return false;

    // Mark as verified
    this.sessions.verify(session, message.from, message.senderName);

    // Fire callback asynchronously (don't block message processing)
    this.fireCallback(session).catch((err) => {
      console.error(`[auth] Callback failed for session ${session.id}: ${err.message}`);
    });

    console.log(`[auth] Session ${session.id} verified (${session.method}) for ${session.verifiedPhone}`);
    return true;
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
