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

export interface RouteConfig {
  channel: string;
  match: string;
  webhook: string;
}

export interface OnboardingCodeConfig {
  code: string;
  name: string;
  webhook: string;
  channels?: string[]; // e.g. ['whatsapp', 'telegram'] — default: all
}

export interface OnboardingConfig {
  codes?: OnboardingCodeConfig[];
}

export interface DashboardConfig {
  enabled?: boolean;
}

export interface AppConfig {
  channels: Record<string, ChannelConfig>;
  routes: RouteConfig[];
  onboarding?: OnboardingConfig;
  apiPort?: number;
  dashboard?: DashboardConfig;
}
