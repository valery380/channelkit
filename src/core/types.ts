export interface UnifiedMessage {
  id: string;
  channel: string;        // channel type: 'whatsapp' | 'telegram' | 'email'
  channelName?: string;   // config key: 'main-wa', 'support-bot', etc.
  from: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker' | 'email';
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
  // Email-specific fields
  email?: {
    subject?: string;
    html?: string;
    to?: string;
    cc?: string[];
    threadId?: string;
    messageId?: string;     // RFC Message-ID for threading
    attachments?: { filename: string; mimetype: string; buffer: Buffer }[];
  };
  // Endpoint-specific fields
  endpoint?: {
    body?: any;               // raw parsed request body (JSON object, form data, etc.)
    query?: Record<string, string>; // query parameters
    headers?: Record<string, string>; // selected request headers
    method?: string;          // HTTP method used
  };
}

export interface GroupUpdateEvent {
  groupId: string;
  participants: string[];
  action: 'add' | 'remove' | 'promote' | 'demote';
  channel: string;
  channelName: string;
  timestamp: number;
}

export interface WebhookResponse {
  text?: string;
  voice?: boolean;          // if true + TTS configured → convert text to voice message
  media?: {
    url?: string;
    buffer?: Buffer;
    mimetype?: string;
  };
  // Email-specific response fields
  email?: {
    subject?: string;       // reply subject (default: Re: original)
    html?: string;          // HTML body (text used as fallback)
  };
  // Voice: end the call after this response (default: false — keeps listening)
  endcall?: boolean;
  // Internal: signals an error for endpoint channels (not sent to external channels)
  _error?: boolean;
}
