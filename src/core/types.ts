export interface UnifiedMessage {
  id: string;
  channel: string;
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
  media?: {
    url?: string;
    mimetype?: string;
  };
}
