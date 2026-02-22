export interface ChannelConfig {
  type: string;
  [key: string]: unknown;
}

export interface WhatsAppChannelConfig extends ChannelConfig {
  type: 'whatsapp';
  number?: string;
}

export interface TelegramChannelConfig extends ChannelConfig {
  type: 'telegram';
  bot_token: string;
}

export interface ServiceConfig {
  channel: string;          // references a key in channels
  webhook: string;          // endpoint URL
  code?: string;            // magic code for onboarding (groups mode, WhatsApp)
  command?: string;         // slash command for Telegram multi-service (e.g. 'support')
}

// Legacy support
export interface RouteConfig {
  channel: string;
  match: string;
  webhook: string;
}

export interface OnboardingCodeConfig {
  code: string;
  name: string;
  webhook: string;
  channels?: string[];
}

export interface OnboardingConfig {
  codes?: OnboardingCodeConfig[];
}

export interface DashboardConfig {
  enabled?: boolean;
}

export interface AppConfig {
  channels: Record<string, ChannelConfig>;
  services?: Record<string, ServiceConfig>;
  // Legacy — still supported, converted to services internally
  routes?: RouteConfig[];
  onboarding?: OnboardingConfig;
  apiPort?: number;
  dashboard?: DashboardConfig;
}
