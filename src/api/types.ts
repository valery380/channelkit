import { WebSocket, WebSocketServer } from 'ws';
import { Channel } from '../channels/base';
import { Logger } from '../core/logger';

export interface ServerContext {
  channels: Map<string, Channel>;
  logger?: Logger;
  configPath?: string;
  publicUrl: string | null;
  exposeDashboard: boolean;
  apiSecret: string | null;
  startTime: number;
  serverLogBuffer: Array<{ level: string; text: string; ts: number }>;
  latestQR: string | null;
  wss: WebSocketServer;
  broadcast: (msg: any) => void;
  findVoiceConfig?: (channelName: string) => any;
  tunnelStart?: () => Promise<{ url: string }>;
  tunnelStop?: () => Promise<void>;
  tunnelStatus?: () => { active: boolean; url: string | null };
  setPublicUrl: (url: string) => void;
  clearPublicUrl: () => void;
  getBaseUrl: () => string;
  getReplyUrl: (channelName: string, jid: string) => string;
  setExposeDashboard: (value: boolean) => void;
}
