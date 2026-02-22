/**
 * Gmail Channel — OAuth2 + polling
 * 
 * Flow:
 * 1. First run: opens browser for OAuth consent → saves refresh token
 * 2. Polls for new messages at configured interval
 * 3. Sends replies via Gmail API
 */

import { Channel } from '../base';
import { GmailChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expiry: number;
}

export class GmailChannel extends Channel {
  private tokens: GmailTokens | null = null;
  private tokenPath: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastHistoryId: string | null = null;
  private processedIds: Set<string> = new Set();

  constructor(name: string, config: GmailChannelConfig) {
    super(name, config);
    this.tokenPath = join('./auth', `gmail-${name}.json`);
  }

  private get cfg(): GmailChannelConfig {
    return this.config as GmailChannelConfig;
  }

  async connect(): Promise<void> {
    // Load saved tokens
    if (existsSync(this.tokenPath)) {
      this.tokens = JSON.parse(readFileSync(this.tokenPath, 'utf-8'));
    }

    if (!this.tokens?.refresh_token) {
      // Need OAuth flow
      await this.startOAuthFlow();
    } else {
      // Refresh access token
      await this.refreshAccessToken();
    }

    // Get initial history ID
    const profile = await this.gmailApi('GET', '/users/me/profile');
    this.lastHistoryId = profile.historyId;

    // Start polling
    const interval = (this.cfg.poll_interval || 30) * 1000;
    console.log(`✅ Gmail connected: ${this.name} (polling every ${interval / 1000}s)`);
    
    // Poll immediately once, then on interval
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), interval);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    if (!this.tokens) return;
    await this.ensureValidToken();

    const subject = response.email?.subject || '';
    const body = response.email?.html || response.text || '';
    const isHtml = !!response.email?.html;

    // Build RFC 2822 message
    const headers = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
    ].join('\r\n');

    const raw = Buffer.from(`${headers}\r\n\r\n${body}`).toString('base64url');

    await this.gmailApi('POST', '/users/me/messages/send', { raw });
  }

  /**
   * Send a reply to a specific thread
   */
  async sendReply(to: string, response: WebhookResponse, threadId: string, inReplyTo?: string): Promise<void> {
    if (!this.tokens) return;
    await this.ensureValidToken();

    const subject = response.email?.subject || '';
    const body = response.email?.html || response.text || '';
    const isHtml = !!response.email?.html;

    const headers = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    ].join('\r\n');

    const raw = Buffer.from(`${headers}\r\n\r\n${body}`).toString('base64url');

    await this.gmailApi('POST', '/users/me/messages/send', { raw, threadId });
  }

  // --- OAuth Flow ---

  private async startOAuthFlow(): Promise<void> {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(this.cfg.client_id)}` +
      `&redirect_uri=${encodeURIComponent('urn:ietf:wg:oauth:2.0:oob')}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.modify')}` +
      `&access_type=offline` +
      `&prompt=consent`;

    console.log(`\n  📧 Gmail OAuth required for channel "${this.name}"`);
    console.log(`\n  Open this URL in your browser:\n`);
    console.log(`  ${authUrl}\n`);
    console.log(`  Then paste the authorization code below.\n`);

    // Read code from stdin
    const code = await new Promise<string>((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('  Authorization code: ', (answer: string) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    // Exchange code for tokens
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.cfg.client_id,
        client_secret: this.cfg.client_secret,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gmail OAuth failed: ${err}`);
    }

    const data = await res.json() as any;
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry: Date.now() + (data.expires_in * 1000),
    };
    this.saveTokens();
    console.log(`  ✅ Gmail authenticated successfully!\n`);
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) throw new Error('No refresh token');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: this.tokens.refresh_token,
        client_id: this.cfg.client_id,
        client_secret: this.cfg.client_secret,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gmail token refresh failed: ${err}`);
    }

    const data = await res.json() as any;
    this.tokens.access_token = data.access_token;
    this.tokens.expiry = Date.now() + (data.expires_in * 1000);
    this.saveTokens();
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.tokens) throw new Error('Not authenticated');
    if (Date.now() > this.tokens.expiry - 60000) {
      await this.refreshAccessToken();
    }
  }

  private saveTokens(): void {
    const dir = dirname(this.tokenPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.tokenPath, JSON.stringify(this.tokens, null, 2));
  }

  // --- Gmail API ---

  private async gmailApi(method: string, path: string, body?: any): Promise<any> {
    await this.ensureValidToken();

    const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.tokens!.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gmail API ${method} ${path}: ${res.status} ${err}`);
    }

    return res.json();
  }

  // --- Polling ---

  private async poll(): Promise<void> {
    try {
      await this.ensureValidToken();

      // List new messages
      const labels = this.cfg.labels || ['INBOX'];
      const labelQuery = labels.map(l => `label:${l}`).join(' OR ');
      const query = `is:unread ${labelQuery}`;

      const list = await this.gmailApi('GET',
        `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`
      );

      if (!list.messages || list.messages.length === 0) return;

      for (const { id } of list.messages) {
        if (this.processedIds.has(id)) continue;
        this.processedIds.add(id);

        // Keep processed set bounded
        if (this.processedIds.size > 1000) {
          const arr = [...this.processedIds];
          this.processedIds = new Set(arr.slice(-500));
        }

        const msg = await this.gmailApi('GET',
          `/users/me/messages/${id}?format=full`
        );

        const unified = this.toUnified(msg);
        if (unified) {
          this.emitMessage(unified);
          // Mark as read
          await this.gmailApi('POST', `/users/me/messages/${id}/modify`, {
            removeLabelIds: ['UNREAD'],
          });
        }
      }
    } catch (err) {
      console.error(`[gmail:${this.name}] Poll error:`, err);
    }
  }

  private toUnified(msg: any): UnifiedMessage | null {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value;

    const from = getHeader('From') || '';
    const subject = getHeader('Subject') || '';
    const to = getHeader('To') || '';
    const cc = getHeader('Cc')?.split(',').map((s: string) => s.trim()) || [];
    const messageId = getHeader('Message-ID') || '';

    // Extract body
    let textBody = '';
    let htmlBody = '';
    this.extractBody(msg.payload, (text, html) => {
      if (text) textBody = text;
      if (html) htmlBody = html;
    });

    // Extract sender email
    const emailMatch = from.match(/<(.+?)>/) || [null, from];
    const senderEmail = emailMatch[1] || from;
    const senderName = from.replace(/<.+?>/, '').trim().replace(/^"|"$/g, '');

    return {
      id: msg.id,
      channel: 'email',
      from: senderEmail,
      type: 'email',
      text: textBody || subject,
      timestamp: Math.floor(parseInt(msg.internalDate) / 1000),
      senderName: senderName || undefined,
      email: {
        subject,
        html: htmlBody || undefined,
        to,
        cc: cc.length > 0 ? cc : undefined,
        threadId: msg.threadId,
        messageId,
      },
    };
  }

  private extractBody(part: any, cb: (text?: string, html?: string) => void): void {
    if (!part) return;

    if (part.mimeType === 'text/plain' && part.body?.data) {
      cb(Buffer.from(part.body.data, 'base64url').toString('utf-8'));
    }
    if (part.mimeType === 'text/html' && part.body?.data) {
      cb(undefined, Buffer.from(part.body.data, 'base64url').toString('utf-8'));
    }

    if (part.parts) {
      for (const subpart of part.parts) {
        this.extractBody(subpart, cb);
      }
    }
  }
}
