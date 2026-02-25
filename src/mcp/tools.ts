import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Channel } from '../channels/base';
import { Logger } from '../core/logger';
import { AppConfig } from '../config/types';
import { loadConfig, saveConfig } from '../config/parser';

export interface McpContext {
  channels: Map<string, Channel>;
  logger?: Logger;
  configPath?: string;
  config: AppConfig;
  startTime: number;
  getPublicUrl: () => string | null;
}

export function registerTools(mcp: McpServer, ctx: McpContext): void {
  // ── Messaging ──────────────────────────────────────────────

  mcp.tool(
    'send_message',
    'Send a message through a connected channel',
    {
      channel: z.string().describe('Channel name'),
      to: z.string().describe('Recipient identifier. For WhatsApp: phone number (e.g. +972541234567) — automatically converted to JID format. For other channels: chat ID, email, etc.'),
      text: z.string().optional().describe('Message text'),
      media: z.string().optional().describe('Media URL to attach'),
    },
    async ({ channel: channelName, to, text, media }) => {
      const ch = ctx.channels.get(channelName);
      if (!ch) {
        return { content: [{ type: 'text', text: `Channel "${channelName}" not found. Available: ${[...ctx.channels.keys()].join(', ')}` }], isError: true };
      }
      if (!text && !media) {
        return { content: [{ type: 'text', text: 'Must provide text and/or media' }], isError: true };
      }

      // Normalize WhatsApp recipient: convert phone numbers to JID format
      let recipient = to;
      if ((ch as any).config?.type === 'whatsapp' && !to.includes('@')) {
        recipient = to.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      }

      try {
        await ch.send(recipient, { text, media: media ? { url: media } : undefined });
        if (ctx.logger) {
          ctx.logger.log({
            id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Math.floor(Date.now() / 1000),
            channel: channelName,
            from: 'system (mcp)',
            senderName: 'MCP',
            text: text || '(media)',
            type: 'mcp-outbound',
            route: 'mcp:send_message',
            status: 'success',
            latency: 0,
          });
        }
        return { content: [{ type: 'text', text: `Message sent via ${channelName} to ${to}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed to send: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'get_messages',
    'Get message history from the logs',
    {
      channel: z.string().optional().describe('Filter by channel name'),
      limit: z.number().optional().describe('Max number of messages (default 50)'),
      search: z.string().optional().describe('Search text in messages'),
    },
    async ({ channel, limit, search }) => {
      if (!ctx.logger) {
        return { content: [{ type: 'text', text: 'Logger not available' }], isError: true };
      }
      const results = ctx.logger.search({
        limit: limit || 50,
        channel: channel || undefined,
        search: search || undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }
  );

  // ── Channel Management ─────────────────────────────────────

  mcp.tool(
    'list_channels',
    'List all configured channels with their status',
    {},
    async () => {
      const channels: Record<string, any> = {};
      if (ctx.configPath) {
        try {
          const config = loadConfig(ctx.configPath, { validate: false });
          for (const [name, cfg] of Object.entries(config.channels)) {
            channels[name] = {
              type: cfg.type,
              mode: cfg.mode,
              connected: ctx.channels.has(name),
            };
          }
        } catch {
          // Fall back to runtime channels
          for (const [name, ch] of ctx.channels) {
            channels[name] = { type: (ch as any).config?.type, connected: true };
          }
        }
      } else {
        for (const [name, ch] of ctx.channels) {
          channels[name] = { type: (ch as any).config?.type, connected: true };
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(channels, null, 2) }] };
    }
  );

  mcp.tool(
    'add_channel',
    'Add a new channel to the configuration (requires restart to take effect)',
    {
      name: z.string().describe('Channel name'),
      type: z.enum(['whatsapp', 'telegram', 'email', 'sms', 'voice']).describe('Channel type'),
      config: z.record(z.string(), z.any()).optional().describe('Channel-specific configuration (bot_token, api_key, etc.)'),
    },
    async ({ name, type, config: channelConfig }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set — cannot modify config' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (config.channels[name]) {
          return { content: [{ type: 'text', text: `Channel "${name}" already exists` }], isError: true };
        }
        config.channels[name] = { type, ...channelConfig };
        saveConfig(ctx.configPath, config);
        return { content: [{ type: 'text', text: `Channel "${name}" (${type}) added. Restart ChannelKit to connect it.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'remove_channel',
    'Remove a channel and its dependent services from the configuration',
    { name: z.string().describe('Channel name to remove') },
    async ({ name }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.channels[name]) {
          return { content: [{ type: 'text', text: `Channel "${name}" not found` }], isError: true };
        }
        delete config.channels[name];
        const removedServices: string[] = [];
        if (config.services) {
          for (const [svcName, svc] of Object.entries(config.services)) {
            if (svc.channel === name) {
              delete config.services[svcName];
              removedServices.push(svcName);
            }
          }
        }
        saveConfig(ctx.configPath, config);
        let msg = `Channel "${name}" removed.`;
        if (removedServices.length > 0) msg += ` Also removed services: ${removedServices.join(', ')}.`;
        msg += ' Restart ChannelKit to apply.';
        return { content: [{ type: 'text', text: msg }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Service Management ─────────────────────────────────────

  mcp.tool(
    'list_services',
    'List all configured services',
    {},
    async () => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: JSON.stringify(ctx.config.services || {}, null, 2) }] };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        return { content: [{ type: 'text', text: JSON.stringify(config.services || {}, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'add_service',
    'Create a new service',
    {
      name: z.string().describe('Service name'),
      channel: z.string().describe('Channel name this service uses'),
      webhook: z.string().describe('Webhook URL for this service'),
      code: z.string().optional().describe('Magic code for onboarding (groups mode)'),
      command: z.string().optional().describe('Slash command for Telegram multi-service'),
      stt: z.object({
        provider: z.enum(['google', 'whisper', 'deepgram']),
        language: z.string().optional(),
      }).optional().describe('Speech-to-text config'),
      tts: z.object({
        provider: z.enum(['google', 'elevenlabs', 'openai']),
        voice: z.string().optional(),
        language: z.string().optional(),
      }).optional().describe('Text-to-speech config'),
    },
    async ({ name, channel, webhook, code, command, stt, tts }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.services) config.services = {};
        if (config.services[name]) {
          return { content: [{ type: 'text', text: `Service "${name}" already exists` }], isError: true };
        }
        if (!config.channels[channel]) {
          return { content: [{ type: 'text', text: `Channel "${channel}" does not exist` }], isError: true };
        }
        const svc: any = { channel, webhook };
        if (code) svc.code = code;
        if (command) svc.command = command;
        if (stt) svc.stt = stt;
        if (tts) svc.tts = tts;
        config.services[name] = svc;
        saveConfig(ctx.configPath, config);
        return { content: [{ type: 'text', text: `Service "${name}" created. Restart ChannelKit to activate.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'update_service',
    'Update an existing service',
    {
      name: z.string().describe('Service name to update'),
      webhook: z.string().optional().describe('New webhook URL'),
      code: z.string().optional().describe('New magic code'),
      command: z.string().optional().describe('New slash command'),
      stt: z.object({
        provider: z.enum(['google', 'whisper', 'deepgram']),
        language: z.string().optional(),
      }).optional().describe('New STT config'),
      tts: z.object({
        provider: z.enum(['google', 'elevenlabs', 'openai']),
        voice: z.string().optional(),
        language: z.string().optional(),
      }).optional().describe('New TTS config'),
    },
    async ({ name, webhook, code, command, stt, tts }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.services?.[name]) {
          return { content: [{ type: 'text', text: `Service "${name}" not found` }], isError: true };
        }
        if (webhook) config.services[name].webhook = webhook;
        if (code !== undefined) {
          if (code) config.services[name].code = code;
          else delete config.services[name].code;
        }
        if (command !== undefined) {
          if (command) config.services[name].command = command;
          else delete config.services[name].command;
        }
        if (stt !== undefined) {
          if (stt) config.services[name].stt = stt;
          else delete config.services[name].stt;
        }
        if (tts !== undefined) {
          if (tts) config.services[name].tts = tts;
          else delete config.services[name].tts;
        }
        saveConfig(ctx.configPath, config);
        return { content: [{ type: 'text', text: `Service "${name}" updated. Restart to apply changes.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'remove_service',
    'Remove a service from the configuration',
    { name: z.string().describe('Service name to remove') },
    async ({ name }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.services?.[name]) {
          return { content: [{ type: 'text', text: `Service "${name}" not found` }], isError: true };
        }
        delete config.services![name];
        saveConfig(ctx.configPath, config);
        return { content: [{ type: 'text', text: `Service "${name}" removed. Restart to apply.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Status ─────────────────────────────────────────────────

  mcp.tool(
    'get_status',
    'Get ChannelKit status: connected channels, uptime, message stats',
    {},
    async () => {
      const channelStatus: Record<string, any> = {};
      for (const [name, ch] of ctx.channels) {
        channelStatus[name] = {
          type: (ch as any).config?.type,
          connected: true,
        };
      }

      const stats = ctx.logger?.getStats() || { total: 0, byChannel: {}, avgLatency: 0, errorCount: 0 };
      const uptime = Date.now() - ctx.startTime;

      const status = {
        uptime_ms: uptime,
        uptime_human: formatUptime(uptime),
        channels: channelStatus,
        messages: stats,
        public_url: ctx.getPublicUrl(),
      };
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  mcp.tool(
    'set_config',
    'Set a configuration value using a dot-separated path. Examples: set_config("apiPort", 5000), set_config("tunnel.expose_dashboard", true), set_config("settings.openai_api_key", "sk-..."), set_config("mcp.enabled", true). Changes are saved to config.yaml. Some changes require a restart to take effect.',
    {
      path: z.string().describe('Dot-separated config path (e.g. "apiPort", "tunnel.token", "settings.openai_api_key", "mcp.enabled")'),
      value: z.any().describe('Value to set (string, number, boolean, or null to delete the key)'),
    },
    async ({ path, value }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set — cannot modify config' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        const parts = path.split('.');
        let target: any = config;

        // Navigate to parent
        for (let i = 0; i < parts.length - 1; i++) {
          if (target[parts[i]] === undefined || target[parts[i]] === null) {
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }

        const key = parts[parts.length - 1];

        if (value === null) {
          delete target[key];
        } else {
          target[key] = value;
        }

        saveConfig(ctx.configPath, config);
        const display = value === null ? '(deleted)' : JSON.stringify(value);
        return { content: [{ type: 'text', text: `Set ${path} = ${display}. Restart ChannelKit if needed to apply.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}
