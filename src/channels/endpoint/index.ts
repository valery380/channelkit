import { Channel } from '../base';
import { EndpointChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

interface PendingResponse {
  resolve: (response: WebhookResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class EndpointChannel extends Channel {
  private pendingResponses: Map<string, PendingResponse> = new Map();

  constructor(name: string, config: EndpointChannelConfig) {
    super(name, config);
  }

  get cfg(): EndpointChannelConfig {
    return this.config as EndpointChannelConfig;
  }

  async connect(): Promise<void> {
    const method = (this.cfg.method || 'POST').toUpperCase();
    const mode = this.cfg.response_mode || 'sync';
    console.log(`[endpoint:${this.name}] Ready — ${method} /inbound/endpoint/${this.name} (${mode})`);
  }

  async disconnect(): Promise<void> {
    for (const [key, pending] of this.pendingResponses) {
      clearTimeout(pending.timer);
      pending.resolve({ text: 'Channel disconnected' });
    }
    this.pendingResponses.clear();
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    const pending = this.pendingResponses.get(to);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingResponses.delete(to);
      pending.resolve(response);
    }
  }

  /**
   * Called by the inbound route handler.
   * Creates a UnifiedMessage, emits it, and optionally returns a promise
   * that resolves when the pipeline calls send() (sync mode).
   */
  handleRequest(
    body: any,
    query: Record<string, string>,
    headers: Record<string, string>,
    method: string,
  ): { message: UnifiedMessage; waitForResponse?: Promise<WebhookResponse> } {
    const requestId = `endpoint-${this.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fromId = `endpoint:${requestId}`;

    // Build text from request
    let text: string | undefined;
    if (method === 'GET') {
      text = query.text || JSON.stringify(query);
    } else {
      text = typeof body === 'string' ? body : (body != null ? JSON.stringify(body) : undefined);
    }

    const message: UnifiedMessage = {
      id: requestId,
      channel: 'endpoint',
      from: fromId,
      type: 'text',
      text,
      timestamp: Math.floor(Date.now() / 1000),
      endpoint: {
        body: method !== 'GET' ? body : undefined,
        query,
        headers,
        method,
      },
    };

    let waitForResponse: Promise<WebhookResponse> | undefined;

    if (this.cfg.response_mode === 'sync' || this.cfg.response_mode == null) {
      const timeout = (this.cfg.response_timeout || 30) * 1000;
      waitForResponse = new Promise<WebhookResponse>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingResponses.delete(fromId);
          resolve({ text: 'Response timeout', _error: true });
        }, timeout);
        this.pendingResponses.set(fromId, { resolve, timer });
      });
    }

    this.emitMessage(message);

    return { message, waitForResponse };
  }
}
