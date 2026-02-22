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

export interface STTServiceConfig {
  provider: 'google' | 'whisper' | 'deepgram';
  language?: string;        // e.g. 'he-IL', 'en-US'
}

export interface TTSServiceConfig {
  provider: 'google' | 'elevenlabs' | 'openai';
  voice?: string;           // voice ID or name
  language?: string;        // e.g. 'he-IL' (for Google TTS)
}

export interface ServiceConfig {
  channel: string;          // references a key in channels
  webhook: string;          // endpoint URL
  code?: string;            // magic code for onboarding (groups mode, WhatsApp)
  command?: string;         // slash command for Telegram multi-service (e.g. 'support')
  stt?: STTServiceConfig;   // speech-to-text config
  tts?: TTSServiceConfig;   // text-to-speech config
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
