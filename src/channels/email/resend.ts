/**
 * Resend Channel — API send + inbound webhook
 * 
 * Inbound: Resend forwards incoming emails to a webhook endpoint on ChannelKit
 * Outbound: Sends via Resend API
 * 
 * Requires: public URL for inbound webhook, Resend API key, verified domain
 */

import { Channel } from '../base';
import { ResendChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

export class ResendChannel extends Channel {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenId: string | null = null;

  constructor(name: string, config: ResendChannelConfig) {
    super(name, config);
  }

  private get cfg(): ResendChannelConfig {
    return this.config as ResendChannelConfig;
  }

  async connect(): Promise<void> {
    console.log(`✅ Resend email connected: ${this.name} (from: ${this.cfg.from_email})`);

    if (this.cfg.poll_interval) {
      // Polling mode — no public URL needed
      const interval = this.cfg.poll_interval * 1000;
      console.log(`  📬 Polling for inbound emails every ${this.cfg.poll_interval}s`);
      this.poll(); // initial poll
      this.pollTimer = setInterval(() => this.poll(), interval);
    } else {
      // Webhook mode
      console.log(`  📬 Configure Resend inbound webhook to point to your ChannelKit API endpoint`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    const subject = response.email?.subject || 'No Subject';
    const html = response.email?.html || undefined;
    const text = response.text || '';

    const body: any = {
      from: this.cfg.from_email,
      to: [to],
      subject,
    };
    if (html) body.html = html;
    else body.text = text;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cfg.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend send error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    console.log(`[resend:${this.name}] Sent email to ${to}: ${data.id}`);
  }

  /**
   * Handle inbound webhook from Resend.
   * Called by ApiServer when POST /inbound/resend/<channelName> is hit.
   */
  handleInbound(payload: any): void {
    const unified = this.toUnified(payload);
    if (unified) {
      this.emitMessage(unified);
    }
  }

  // --- Polling ---

  private async poll(): Promise<void> {
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (this.lastSeenId) params.set('after', this.lastSeenId);

      const res = await fetch(`https://api.resend.com/emails/received?${params}`, {
        headers: { 'Authorization': `Bearer ${this.cfg.api_key}` },
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[resend:${this.name}] Poll error: ${res.status} ${err}`);
        return;
      }

      const data = await res.json() as any;
      const emails = data.data || [];

      if (emails.length === 0) return;

      // Process from oldest to newest
      for (const email of emails.reverse()) {
        this.lastSeenId = email.id;

        // Fetch full email content
        const detail = await this.fetchEmail(email.id);
        if (detail) {
          const unified = this.toUnified(detail);
          if (unified) this.emitMessage(unified);
        }
      }
    } catch (err) {
      console.error(`[resend:${this.name}] Poll error:`, err);
    }
  }

  private async fetchEmail(id: string): Promise<any> {
    const res = await fetch(`https://api.resend.com/emails/received/${id}`, {
      headers: { 'Authorization': `Bearer ${this.cfg.api_key}` },
    });
    if (!res.ok) return null;
    return res.json();
  }

  private toUnified(payload: any): UnifiedMessage | null {
    // Resend inbound webhook payload
    const from = payload.from || '';
    const subject = payload.subject || '';
    const text = payload.text || payload.plain || '';
    const html = payload.html || '';
    const to = payload.to || '';
    const cc = payload.cc ? (Array.isArray(payload.cc) ? payload.cc : [payload.cc]) : undefined;

    // Extract sender email
    const emailMatch = from.match(/<(.+?)>/);
    const senderEmail = emailMatch ? emailMatch[1] : from;
    const senderName = from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '') || undefined;

    return {
      id: payload.id || `resend-${Date.now()}`,
      channel: 'email',
      from: senderEmail,
      type: 'email',
      text: text || subject,
      timestamp: Math.floor(Date.now() / 1000),
      senderName,
      email: {
        subject,
        html: html || undefined,
        to: Array.isArray(to) ? to.join(', ') : to,
        cc,
        messageId: payload.message_id,
      },
    };
  }
}
