import { WebSocket, WebSocketServer } from 'ws';
import { Channel } from '../channels/base';
import { Logger } from '../core/logger';
import type { AuthModule } from '../auth';

export interface ServerContext {
  channels: Map<string, Channel>;
  logger?: Logger;
  configPath?: string;
  publicUrl: string | null;
  exposeDashboard: boolean;
  exposeMcp: boolean;
  apiSecret: string | null;
  mcpSecret: string | null;
  startTime: number;
  serverLogBuffer: Array<{ level: string; text: string; ts: number }>;
  latestQR: string | null;
  wss: WebSocketServer;
  broadcast: (msg: any) => void;
  findVoiceConfig?: (channelName: string) => any;
  tunnelStart?: () => Promise<{ url: string }>;
  tunnelStop?: () => Promise<void>;
  tunnelStatus?: () => { active: boolean; url: string | null };
  mcpStart?: () => Promise<{ url: string }>;
  mcpStop?: () => Promise<void>;
  mcpStatus?: () => { active: boolean; url: string | null };
  updateStatus?: () => Promise<{ mode: string; currentVersion: string; latestVersion: string; updateAvailable: boolean; behindCount: number; lastChecked: number }>;
  updateTrigger?: () => Promise<{ success: boolean; previousVersion: string; newVersion: string; error?: string }>;
  reloadRouter?: () => void;
  setPublicUrl: (url: string) => void;
  clearPublicUrl: () => void;
  getBaseUrl: () => string;
  getReplyUrl: (channelName: string, jid: string) => string;
  setExposeDashboard: (value: boolean) => void;
  setExposeMcp: (value: boolean) => void;
  authModule?: AuthModule;
}
