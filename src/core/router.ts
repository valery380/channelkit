import { ServiceConfig, RouteConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from './types';
import { dispatchWebhook } from './webhook';
import { GroupStore } from './groupStore';
import { Logger } from './logger';

export class Router {
  private groupStore?: GroupStore;
  private logger?: Logger;
  private services: Map<string, ServiceConfig> = new Map();
  // channelName → ServiceConfig[] for quick lookup
  private servicesByChannel: Map<string, ServiceConfig[]> = new Map();

  constructor(services?: Record<string, ServiceConfig>, legacyRoutes?: RouteConfig[]) {
    // Load services
    if (services) {
      for (const [name, svc] of Object.entries(services)) {
        this.services.set(name, svc);
        const list = this.servicesByChannel.get(svc.channel) || [];
        list.push(svc);
        this.servicesByChannel.set(svc.channel, list);
      }
    }

    // Convert legacy routes to services
    if (legacyRoutes) {
      for (let i = 0; i < legacyRoutes.length; i++) {
        const route = legacyRoutes[i];
        const name = `_route_${i}`;
        const svc: ServiceConfig = {
          channel: route.channel,
          webhook: route.webhook,
        };
        this.services.set(name, svc);
        const list = this.servicesByChannel.get(route.channel) || [];
        list.push(svc);
        this.servicesByChannel.set(route.channel, list);
      }
    }
  }

  setGroupStore(store: GroupStore): void {
    this.groupStore = store;
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Determine the mode for a channel:
   * - 1 service → direct (all messages go to that webhook)
   * - 2+ services → groups (route by group mapping)
   */
  getChannelMode(channelName: string): 'direct' | 'groups' {
    const services = this.servicesByChannel.get(channelName) || [];
    return services.length <= 1 ? 'direct' : 'groups';
  }

  /**
   * Get the webhook for a direct-mode channel
   */
  getDirectWebhook(channelName: string): string | undefined {
    const services = this.servicesByChannel.get(channelName) || [];
    return services.length === 1 ? services[0].webhook : undefined;
  }

  /**
   * Get all services for a channel (for onboarding codes)
   */
  getServicesForChannel(channelName: string): ServiceConfig[] {
    return this.servicesByChannel.get(channelName) || [];
  }

  /**
   * Get all services
   */
  getAllServices(): Map<string, ServiceConfig> {
    return this.services;
  }

  /**
   * Get services for a channel with their names, for building service lists.
   */
  getNamedServicesForChannel(channelName: string): Array<{ name: string; config: ServiceConfig }> {
    const result: Array<{ name: string; config: ServiceConfig }> = [];
    for (const [name, svc] of this.services.entries()) {
      if (svc.channel === channelName) result.push({ name, config: svc });
    }
    return result;
  }

  /**
   * Find the service config that would handle this message
   */
  findServiceConfig(message: UnifiedMessage): ServiceConfig | undefined {
    const channelName = message.channelName || message.channel;

    // Pre-resolved webhook (Telegram slash commands)
    if ((message as any)._resolvedWebhook) {
      for (const svc of this.services.values()) {
        if (svc.webhook === (message as any)._resolvedWebhook) return svc;
      }
    }

    // Group mapping
    if (message.groupId && this.groupStore) {
      const mapping = this.groupStore.get(message.groupId);
      if (mapping) {
        for (const svc of this.services.values()) {
          if (svc.webhook === mapping.webhook) return svc;
        }
      }
    }

    // Direct mode
    const services = this.servicesByChannel.get(channelName) || [];
    if (services.length === 1) return services[0];

    const byType = this.servicesByChannel.get(message.channel) || [];
    if (byType.length === 1) return byType[0];

    return undefined;
  }

  private findWebhook(message: UnifiedMessage): string | undefined {
    const channelName = message.channelName || message.channel;

    // Check for pre-resolved webhook (e.g. Telegram slash commands)
    if ((message as any)._resolvedWebhook) {
      return (message as any)._resolvedWebhook;
    }

    // Check group→service mapping first (groups mode)
    if (message.groupId && this.groupStore) {
      const mapping = this.groupStore.get(message.groupId);
      if (mapping) return mapping.webhook;
    }

    // Direct mode: single service on this channel
    const services = this.servicesByChannel.get(channelName) || [];
    if (services.length === 1) return services[0].webhook;

    // Fallback: try matching by channel type (legacy)
    const byType = this.servicesByChannel.get(message.channel) || [];
    if (byType.length === 1) return byType[0].webhook;

    return undefined;
  }

  async route(message: UnifiedMessage, replyUrl?: string): Promise<{ response: WebhookResponse | null; webhook?: string; latency: number }> {
    const webhook = this.findWebhook(message);
    const startTime = Date.now();

    if (!webhook) {
      console.log(`[router] No service matched for message ${message.id} on ${message.channelName || message.channel}`);
      return { response: null, webhook: undefined, latency: 0 };
    }

    console.log(`[router] Routing ${message.id} → ${webhook}`);
    const response = await dispatchWebhook(webhook, message, replyUrl);
    const latency = Date.now() - startTime;
    return { response, webhook, latency };
  }
}
