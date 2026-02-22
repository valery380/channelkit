export interface UnifiedMessage {
  id: string;
  channel: string;        // channel type: 'whatsapp' | 'telegram'
  channelName?: string;   // config key: 'main-wa', 'support-bot', etc.
  from: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker';
  text?: string;
  timestamp: number;
  replyTo?: string;
  media?: {
    url?: string;
    buffer?: Buffer;
    mimetype?: string;
    filename?: string;
  };
  senderName?: string;
  groupId?: string;
  groupName?: string;
}

export interface WebhookResponse {
  text?: string;
  voice?: boolean;          // if true + TTS configured → convert text to voice message
  media?: {
    url?: string;
    buffer?: Buffer;
    mimetype?: string;
  };
}
