import { ServiceConfig, RouteConfig, ChannelConfig, SettingsConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from './types';
import { dispatchWebhook, resolvePlaceholders, WebhookError } from './webhook';
import { GroupStore } from './groupStore';
import { Logger } from './logger';
import { aiRoute } from './aiRouter';

export class Router {
  private groupStore?: GroupStore;
  private logger?: Logger;
  private settings: SettingsConfig = {};
  private services: Map<string, ServiceConfig> = new Map();
  // channelName → ServiceConfig[] for quick lookup
  private servicesByChannel: Map<string, ServiceConfig[]> = new Map();
  private channelConfigs: Record<string, ChannelConfig> = {};

  constructor(services?: Record<string, ServiceConfig>, legacyRoutes?: RouteConfig[], channelConfigs?: Record<string, ChannelConfig>) {
    if (channelConfigs) this.channelConfigs = channelConfigs;
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

  /**
   * Hot-reload services from updated config (e.g. after dashboard edits).
   * Preserves legacy routes already loaded.
   */
  reloadServices(services: Record<string, ServiceConfig>, channelConfigs?: Record<string, ChannelConfig>): void {
    if (channelConfigs) this.channelConfigs = channelConfigs;
    // Remove non-legacy services
    for (const name of [...this.services.keys()]) {
      if (!name.startsWith('_route_')) {
        this.services.delete(name);
      }
    }
    // Rebuild servicesByChannel (keep legacy routes)
    this.servicesByChannel.clear();
    for (const [name, svc] of this.services.entries()) {
      const list = this.servicesByChannel.get(svc.channel) || [];
      list.push(svc);
      this.servicesByChannel.set(svc.channel, list);
    }
    // Add updated services
    for (const [name, svc] of Object.entries(services)) {
      this.services.set(name, svc);
      const list = this.servicesByChannel.get(svc.channel) || [];
      list.push(svc);
      this.servicesByChannel.set(svc.channel, list);
    }
  }

  setGroupStore(store: GroupStore): void {
    this.groupStore = store;
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  setSettings(settings: SettingsConfig): void {
    this.settings = settings;
  }

  /**
   * Determine the mode for a channel:
   * - Explicit mode in channel config takes priority
   * - Otherwise: 1 service → direct, 2+ services → groups
   */
  getChannelMode(channelName: string): 'direct' | 'groups' | 'ai' {
    const explicitMode = this.channelConfigs[channelName]?.mode;
    if (explicitMode === 'ai') return 'ai';
    if (explicitMode === 'groups') return 'groups';
    if (explicitMode === 'service') return 'direct';
    const services = this.servicesByChannel.get(channelName) || [];
    return services.length <= 1 ? 'direct' : 'groups';
  }

  /**
   * Use AI to route a message to the appropriate service.
   */
  async aiRouteMessage(message: UnifiedMessage): Promise<{ name: string; config: ServiceConfig } | undefined> {
    const channelName = message.channelName || message.channel;
    const channelConfig = this.channelConfigs[channelName];
    if (!channelConfig?.ai_routing) return undefined;

    const services = this.getNamedServicesForChannel(channelName);
    if (services.length === 0) return undefined;

    const serviceInfos = services.map(s => ({ name: s.name, webhook: s.config.webhook, description: s.config.description }));
    const result = await aiRoute(message.text || '', serviceInfos, channelConfig, this.settings);

    if (result.error) {
      console.log(`[router] AI routing error: ${result.error}`);
    }

    if (result.serviceName) {
      const matched = this.services.get(result.serviceName);
      if (matched && matched.channel === channelName) return { name: result.serviceName, config: matched };
      // Fuzzy match: AI might return slightly different casing
      for (const [name, svc] of this.services.entries()) {
        if (svc.channel === channelName && name.toLowerCase() === result.serviceName.toLowerCase()) return { name, config: svc };
      }
    }

    return undefined;
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

    // Group mapping — look up by service name (stable), fall back to webhook URL
    if (message.groupId && this.groupStore) {
      const mapping = this.groupStore.get(message.groupId);
      if (mapping) {
        const byName = this.services.get(mapping.serviceName);
        if (byName && byName.channel === channelName) return byName;
        for (const svc of this.services.values()) {
          if (svc.webhook === mapping.webhook && svc.channel === channelName) return svc;
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

  /**
   * Find the service name for a given webhook URL on a channel.
   */
  findServiceName(channelName: string, webhook: string): string | undefined {
    for (const [name, svc] of this.services.entries()) {
      if (svc.channel === channelName && svc.webhook === webhook) return name;
    }
    return undefined;
  }

  async route(message: UnifiedMessage, replyUrl?: string): Promise<{ response: WebhookResponse | null; webhook?: string; latency: number; webhookError?: WebhookError }> {
    const svc = this.findServiceConfig(message);
    const startTime = Date.now();

    if (!svc) {
      console.log(`[router] No service matched for message ${message.id} on ${message.channelName || message.channel}`);
      return { response: null, webhook: undefined, latency: 0 };
    }

    const resolvedUrl = resolvePlaceholders(svc.webhook, message);
    console.log(`[router] Routing ${message.id} → ${resolvedUrl}`);
    const timeoutMs = message.media?.buffer ? 30000 : 5000;
    const { response, error: webhookError } = await dispatchWebhook(resolvedUrl, message, replyUrl, { method: svc.method, auth: svc.auth, timeout: timeoutMs });
    const latency = Date.now() - startTime;
    return { response, webhook: resolvedUrl, latency, webhookError };
  }
}
