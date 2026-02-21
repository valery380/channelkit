import { RouteConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from './types';
import { dispatchWebhook } from './webhook';
import { GroupStore } from './groupStore';
import { Logger, LogEntry } from './logger';

export class Router {
  private groupStore?: GroupStore;
  private logger?: Logger;

  constructor(private routes: RouteConfig[]) {}

  setGroupStore(store: GroupStore): void {
    this.groupStore = store;
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  private matchRoute(message: UnifiedMessage): RouteConfig | undefined {
    // Check group→service mapping first
    if (message.groupId && this.groupStore) {
      const mapping = this.groupStore.get(message.groupId);
      if (mapping) {
        return {
          channel: message.channel,
          match: '*',
          webhook: mapping.webhook,
        };
      }
    }

    return this.routes.find((route) => {
      if (route.channel !== '*' && route.channel !== message.channel) {
        return false;
      }
      if (route.match === '*') return true;
      const patterns = route.match.split('|').map((p) => p.trim());
      const text = (message.text || '').toLowerCase();
      return patterns.some((p) => {
        try {
          return new RegExp(p, 'i').test(text);
        } catch {
          return text.includes(p.toLowerCase());
        }
      });
    });
  }

  async route(message: UnifiedMessage, replyUrl?: string): Promise<WebhookResponse | null> {
    const route = this.matchRoute(message);
    const startTime = Date.now();

    if (!route) {
      console.log(`[router] No route matched for message ${message.id} on ${message.channel}`);
      if (this.logger) {
        this.logger.log({
          id: message.id,
          timestamp: Date.now(),
          channel: message.channel,
          from: message.from,
          senderName: message.senderName,
          text: message.text,
          type: message.type,
          groupId: message.groupId,
          groupName: message.groupName,
          status: 'no-route',
        });
      }
      return null;
    }

    console.log(`[router] Routing ${message.id} → ${route.webhook}`);
    const response = await dispatchWebhook(route.webhook, message, replyUrl);
    const latency = Date.now() - startTime;

    if (this.logger) {
      this.logger.log({
        id: message.id,
        timestamp: Date.now(),
        channel: message.channel,
        from: message.from,
        senderName: message.senderName,
        text: message.text,
        type: message.type,
        groupId: message.groupId,
        groupName: message.groupName,
        route: route.webhook,
        responseText: response?.text,
        status: response ? 'success' : 'error',
        latency,
      });
    }

    return response;
  }
}
