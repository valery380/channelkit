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

export interface GmailChannelConfig extends ChannelConfig {
  type: 'email';
  provider: 'gmail';
  client_id: string;
  client_secret: string;
  poll_interval?: number;    // seconds, default 30
  labels?: string[];         // Gmail labels to watch, default ['INBOX']
}

export interface ResendChannelConfig extends ChannelConfig {
  type: 'email';
  provider: 'resend';
  api_key: string;
  from_email: string;        // verified sender, e.g. support@yourdomain.com
  webhook_secret?: string;   // for verifying inbound webhooks
  poll_interval?: number;    // seconds — if set, poll instead of webhook
}

export type EmailChannelConfig = GmailChannelConfig | ResendChannelConfig;

export interface TwilioSMSChannelConfig extends ChannelConfig {
  type: 'sms';
  provider: 'twilio';
  account_sid: string;
  auth_token: string;
  number: string;             // Twilio phone number (e.g. +12025551234)
  poll_interval?: number;     // seconds — if set, poll for inbound SMS (no public URL needed)
}

export interface STTServiceConfig {
  provider: 'google' | 'whisper' | 'deepgram';
  language?: string;                // e.g. 'he-IL', 'en-US' — primary language
  alternative_languages?: string[]; // Google: auto-detect from these + primary
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

export interface TunnelConfig {
  provider?: 'cloudflared';
  public_url?: string;
}

export interface AppConfig {
  channels: Record<string, ChannelConfig>;
  services?: Record<string, ServiceConfig>;
  // Legacy — still supported, converted to services internally
  routes?: RouteConfig[];
  onboarding?: OnboardingConfig;
  apiPort?: number;
  dashboard?: DashboardConfig;
  tunnel?: TunnelConfig;
}
