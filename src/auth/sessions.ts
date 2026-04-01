import { randomUUID, randomInt, randomBytes } from 'crypto';

export interface AuthSession {
  id: string;
  code: string;
  method: 'code' | 'qr';
  phone?: string;            // set for flow A (code), null for flow B (qr)
  status: 'pending' | 'verified' | 'expired';
  verifiedPhone?: string;
  senderName?: string;
  createdAt: number;
  expiresAt: number;
}

export class AuthSessionStore {
  private sessions = new Map<string, AuthSession>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  /** Map of normalized phone → timestamp of last outbound message (for per-phone rate limiting) */
  private phoneThrottles = new Map<string, number>();

  constructor(private ttlSeconds: number = 300) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
  }

  create(method: 'code' | 'qr', phone?: string, codeLength = 6, qrCodeLength = 8): AuthSession {
    const id = randomUUID();
    const code = method === 'code'
      ? this.generateNumericCode(codeLength)
      : this.generateAlphanumericCode(qrCodeLength);
    const now = Date.now();
    const session: AuthSession = {
      id,
      code,
      method,
      phone: phone || undefined,
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): AuthSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (Date.now() > session.expiresAt && session.status === 'pending') {
      session.status = 'expired';
    }
    return session;
  }

  cancel(id: string): boolean {
    return this.sessions.delete(id);
  }

  /**
   * Try to match an incoming message against active auth sessions.
   * Returns the matched session or null.
   */
  matchCode(from: string, text: string): AuthSession | null {
    const normalizedFrom = this.normalizePhone(from);
    const trimmedText = text.trim();

    for (const session of this.sessions.values()) {
      if (session.status !== 'pending') continue;
      if (Date.now() > session.expiresAt) {
        session.status = 'expired';
        continue;
      }

      if (session.method === 'code') {
        // Flow A: phone must match + code must match
        if (session.phone && this.normalizePhone(session.phone) === normalizedFrom && trimmedText === session.code) {
          return session;
        }
      } else {
        // Flow B (QR): message should be "LOGIN-XXXXXXXX" (case-insensitive prefix)
        const prefix = 'LOGIN-';
        if (trimmedText.toUpperCase().startsWith(prefix)) {
          const messageCode = trimmedText.slice(prefix.length).trim();
          if (messageCode.toUpperCase() === session.code.toUpperCase()) {
            return session;
          }
        }
      }
    }
    return null;
  }

  /**
   * Mark a session as verified with the sender's phone and name.
   */
  verify(session: AuthSession, phone: string, senderName?: string): void {
    session.status = 'verified';
    session.verifiedPhone = this.normalizePhone(phone);
    session.senderName = senderName;
  }

  /**
   * Check if a phone number was messaged recently (rate limiting).
   * Returns true if the phone is throttled.
   */
  isPhoneThrottled(phone: string, cooldownMs: number = 300_000): boolean {
    const normalized = this.normalizePhone(phone);
    const lastSent = this.phoneThrottles.get(normalized);
    if (lastSent && Date.now() - lastSent < cooldownMs) return true;
    return false;
  }

  /** Record that a message was sent to a phone number. */
  recordPhoneSend(phone: string): void {
    this.phoneThrottles.set(this.normalizePhone(phone), Date.now());
  }

  /** Get count of pending sessions (for rate limiting). */
  getPendingCount(): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.status === 'pending' && Date.now() <= s.expiresAt) count++;
    }
    return count;
  }

  stop(): void {
    clearInterval(this.cleanupTimer);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      // Remove expired sessions after an extra grace period (for polling)
      if (now > session.expiresAt + 60_000) {
        this.sessions.delete(id);
      }
    }
    // Clean old phone throttle entries
    for (const [phone, ts] of this.phoneThrottles) {
      if (now - ts > 600_000) {
        this.phoneThrottles.delete(phone);
      }
    }
  }

  /** Normalize a phone-like identifier: strip JID suffix, ensure + prefix. */
  private normalizePhone(value: string): string {
    const stripped = value.replace(/@.+$/, '');
    if (/^\+?\d{7,15}$/.test(stripped)) {
      return stripped.startsWith('+') ? stripped : `+${stripped}`;
    }
    return value;
  }

  private generateNumericCode(length: number): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return String(randomInt(min, max + 1));
  }

  private generateAlphanumericCode(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
    const bytes = randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }
}
