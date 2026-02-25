export interface ChannelConfig {
  type: string;
  /** Explicit routing mode set at channel creation.
   *  'service' — single service, no codes or commands needed
   *  'groups'  — multiple services, uses magic codes / slash commands */
  mode?: 'service' | 'groups';
  /** What to do when a message arrives but no service is matched (groups mode only).
   *  'list'   — reply with a list of available services
   *  'ignore' — silently drop the message (default) */
  unmatched?: 'list' | 'ignore';
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
  webhook_id?: string;       // Resend webhook ID (auto-registered)
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

export interface TwilioVoiceChannelConfig extends ChannelConfig {
  type: 'voice';
  provider: 'twilio';
  account_sid: string;
  auth_token: string;
  number: string;             // Twilio phone number
}

export interface EndpointChannelConfig extends ChannelConfig {
  type: 'endpoint';
  method?: string;              // HTTP method: 'POST' | 'GET' | 'PUT' | 'PATCH' (default: 'POST')
  secret?: string;              // Optional secret validated against X-Channel-Secret header
  response_mode?: 'sync' | 'async';  // default: 'sync'
  response_timeout?: number;    // seconds, sync mode only (default: 30)
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

export interface VoiceServiceConfig {
  greeting?: string;        // what to say when answering (e.g. "Hi, how can I help?")
  hold_message?: string;    // what to say while waiting for webhook response
  hold_music?: string;      // URL to hold music (instead of hold_message)
  max_record_seconds?: number; // max recording length, default 30
  language?: string;        // TwiML <Say> language (e.g. 'he-IL')
  voice_name?: string;      // TwiML <Say> voice (e.g. 'Polly.Joanna')
  conversational?: boolean; // true = loop (record→respond→record), false = single exchange + hangup
}

export interface FormatServiceConfig {
  provider: 'openai' | 'anthropic' | 'google';
  model?: string;             // optional, uses sensible defaults per provider
  prompt: string;             // instructions for how to format/transform the text
}

export interface ServiceConfig {
  channel: string;          // references a key in channels
  webhook: string;          // endpoint URL
  code?: string;            // magic code for onboarding (groups mode, WhatsApp)
  command?: string;         // slash command for Telegram multi-service (e.g. 'support')
  stt?: STTServiceConfig;   // speech-to-text config
  tts?: TTSServiceConfig;   // text-to-speech config
  voice?: VoiceServiceConfig; // voice call settings
  format?: FormatServiceConfig; // AI data formatting config
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
  token?: string;              // Cloudflare Tunnel token for stable URLs
  expose_dashboard?: boolean;  // allow dashboard access via tunnel (default: false)
}

export interface SettingsConfig {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  google_api_key?: string;
  elevenlabs_api_key?: string;
  openai_api_key?: string;
  deepgram_api_key?: string;
  anthropic_api_key?: string;
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
  settings?: SettingsConfig;
  api_secret?: string;         // Bearer token required for /api/send/ endpoint
}
