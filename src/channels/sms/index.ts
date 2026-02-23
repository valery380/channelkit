/**
 * Twilio SMS Channel
 * 
 * Inbound: polling (GET /Messages) or webhook (POST /inbound/twilio/<channel>)
 * Outbound: Twilio REST API
 */

import Twilio from 'twilio';
import { Channel } from '../base';
import { TwilioSMSChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

export class TwilioSMSChannel extends Channel {
  private client: ReturnType<typeof Twilio>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPollTime: Date;
  private processedSids: Set<string> = new Set();

  constructor(name: string, config: TwilioSMSChannelConfig) {
    super(name, config);
    this.client = Twilio(config.account_sid, config.auth_token);
    this.lastPollTime = new Date();
  }

  private get cfg(): TwilioSMSChannelConfig {
    return this.config as TwilioSMSChannelConfig;
  }

  async connect(): Promise<void> {
    // Verify the number exists
    try {
      const numbers = await this.client.incomingPhoneNumbers.list({ phoneNumber: this.cfg.number, limit: 1 });
      if (numbers.length > 0) {
        console.log(`✅ Twilio SMS connected: ${this.name} (${this.cfg.number})`);
      } else {
        console.warn(`⚠️  Twilio number ${this.cfg.number} not found in account. SMS may not work.`);
      }
    } catch (err) {
      console.warn(`⚠️  Could not verify Twilio number: ${(err as Error).message}`);
    }

    if (this.cfg.poll_interval) {
      const interval = this.cfg.poll_interval * 1000;
      console.log(`  📱 Polling for inbound SMS every ${this.cfg.poll_interval}s`);
      this.poll();
      this.pollTimer = setInterval(() => this.poll(), interval);
    } else {
      console.log(`  📱 Waiting for inbound SMS via webhook`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    if (!response.text) return;
    const msg = await this.client.messages.create({
      body: response.text,
      from: this.cfg.number,
      to,
    });
    console.log(`[sms:${this.name}] Sent to ${to}: ${msg.sid}`);
  }

  /**
   * Handle inbound webhook from Twilio.
   * Called by ApiServer when POST /inbound/twilio/<channelName> is hit.
   */
  handleInbound(payload: any): void {
    const unified = this.webhookToUnified(payload);
    if (unified) {
      this.emitMessage(unified);
    }
  }

  /**
   * Get the Twilio phone number SID (for webhook configuration)
   */
  async getNumberSid(): Promise<string | null> {
    try {
      const numbers = await this.client.incomingPhoneNumbers.list({ phoneNumber: this.cfg.number, limit: 1 });
      return numbers.length > 0 ? numbers[0].sid : null;
    } catch {
      return null;
    }
  }

  /**
   * Set the SMS webhook URL on this Twilio number
   */
  async setWebhookUrl(url: string): Promise<void> {
    const sid = await this.getNumberSid();
    if (!sid) {
      console.error(`[sms:${this.name}] Cannot set webhook — number not found`);
      return;
    }
    await this.client.incomingPhoneNumbers(sid).update({
      smsUrl: url,
      smsMethod: 'POST',
    });
    console.log(`  📱 Updated Twilio SMS webhook for ${this.cfg.number}`);
  }

  // --- Polling ---

  private async poll(): Promise<void> {
    try {
      console.log(`[sms:${this.name}] Polling Twilio for inbound messages since ${this.lastPollTime.toISOString()}`);
      const messages = await this.client.messages.list({
        to: this.cfg.number,
        dateSentAfter: this.lastPollTime,
        limit: 20,
      });

      // Update poll time for next cycle
      this.lastPollTime = new Date();

      for (const msg of messages) {
        if (this.processedSids.has(msg.sid)) continue;
        if (msg.direction !== 'inbound') continue;
        this.processedSids.add(msg.sid);

        // Keep set bounded
        if (this.processedSids.size > 1000) {
          const arr = [...this.processedSids];
          this.processedSids = new Set(arr.slice(-500));
        }

        const unified = this.apiToUnified(msg);
        if (unified) this.emitMessage(unified);
      }
    } catch (err) {
      console.error(`[sms:${this.name}] Poll error:`, err);
    }
  }

  // --- Convert to UnifiedMessage ---

  private apiToUnified(msg: any): UnifiedMessage {
    return {
      id: msg.sid,
      channel: 'sms',
      from: msg.from,
      type: 'text',
      text: msg.body || '',
      timestamp: Math.floor(new Date(msg.dateSent || msg.dateCreated).getTime() / 1000),
      senderName: undefined,
    };
  }

  private webhookToUnified(payload: any): UnifiedMessage | null {
    if (!payload.From || !payload.Body) return null;

    return {
      id: payload.MessageSid || `twilio-${Date.now()}`,
      channel: 'sms',
      from: payload.From,
      type: 'text',
      text: payload.Body,
      timestamp: Math.floor(Date.now() / 1000),
      senderName: undefined,
    };
  }
}
