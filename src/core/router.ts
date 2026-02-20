import { RouteConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from './types';
import { dispatchWebhook } from './webhook';
import { GroupStore } from './groupStore';

export class Router {
  private groupStore?: GroupStore;

  constructor(private routes: RouteConfig[]) {}

  setGroupStore(store: GroupStore): void {
    this.groupStore = store;
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
    if (!route) {
      console.log(`[router] No route matched for message ${message.id} on ${message.channel}`);
      return null;
    }
    console.log(`[router] Routing ${message.id} → ${route.webhook}`);
    return dispatchWebhook(route.webhook, message, replyUrl);
  }
}
