import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Channel } from '../channels/base';
import { Logger } from '../core/logger';
import { restartProcess } from '../core/restart';
import { Updater } from '../core/updater';
import { AppConfig } from '../config/types';
import { loadConfig, saveConfig } from '../config/parser';

export interface McpContext {
  channels: Map<string, Channel>;
  logger?: Logger;
  configPath?: string;
  config: AppConfig;
  startTime: number;
  getPublicUrl: () => string | null;
  updater?: Updater;
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
            id: randomUUID(),
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
    'Add a new channel to the configuration. Requires restart to take effect — set auto_restart to restart automatically.',
    {
      name: z.string().describe('Channel name'),
      type: z.enum(['whatsapp', 'telegram', 'email', 'sms', 'voice']).describe('Channel type'),
      config: z.record(z.string(), z.any()).optional().describe('Channel-specific configuration (bot_token, api_key, etc.)'),
      allow_list: z.array(z.string()).optional().describe('Optional allow list of sender identifiers (phone numbers). If set, only these senders can use the channel.'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ name, type, config: channelConfig, allow_list, auto_restart }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set — cannot modify config' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (config.channels[name]) {
          return { content: [{ type: 'text', text: `Channel "${name}" already exists` }], isError: true };
        }
        config.channels[name] = {
          type,
          ...channelConfig,
          ...(allow_list && allow_list.length > 0 && { allow_list }),
        };
        saveConfig(ctx.configPath, config);
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: `Channel "${name}" (${type}) added. ChannelKit is restarting...` }] };
        }
        return { content: [{ type: 'text', text: `Channel "${name}" (${type}) added. Restart ChannelKit to connect it.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'remove_channel',
    'Remove a channel and its dependent services from the configuration. Requires restart to apply — set auto_restart to restart automatically.',
    {
      name: z.string().describe('Channel name to remove'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ name, auto_restart }) => {
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
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          msg += ' ChannelKit is restarting...';
        } else {
          msg += ' Restart ChannelKit to apply.';
        }
        return { content: [{ type: 'text', text: msg }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'set_channel_mode',
    'Set a channel\'s routing mode to "service" (single service, direct routing) or "groups" (multiple services via codes/commands). Requires restart to apply — set auto_restart to restart automatically.',
    {
      name: z.string().describe('Channel name'),
      mode: z.enum(['service', 'groups']).describe('Routing mode'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ name, mode, auto_restart }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set — cannot modify config' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });
        if (!config.channels[name]) {
          return { content: [{ type: 'text', text: `Channel "${name}" not found` }], isError: true };
        }
        config.channels[name].mode = mode;
        saveConfig(ctx.configPath, config);
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: `Channel "${name}" mode set to "${mode}". ChannelKit is restarting...` }] };
        }
        return { content: [{ type: 'text', text: `Channel "${name}" mode set to "${mode}". Restart ChannelKit to apply.` }] };
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
    'Create a new service. Requires restart to activate — set auto_restart to restart automatically.',
    {
      name: z.string().describe('Service name'),
      channel: z.string().describe('Channel name this service uses'),
      webhook: z.string().describe('Webhook URL for this service'),
      code: z.string().optional().describe('Magic code for onboarding (groups mode)'),
      command: z.string().optional().describe('Slash command for Telegram multi-service'),
      stt: z.object({
        provider: z.enum(['google', 'whisper', 'deepgram']),
        language: z.string().optional(),
        forward_audio: z.boolean().optional().describe('Send original audio to webhook along with transcription (default: false)'),
      }).optional().describe('Speech-to-text config'),
      tts: z.object({
        provider: z.enum(['google', 'elevenlabs', 'openai']),
        voice: z.string().optional(),
        language: z.string().optional(),
      }).optional().describe('Text-to-speech config'),
      allow_list: z.array(z.string()).optional().describe('Optional allow list of sender identifiers (phone numbers). If set, only these senders can use the service.'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ name, channel, webhook, code, command, stt, tts, allow_list, auto_restart }) => {
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
        if (allow_list && allow_list.length > 0) svc.allow_list = allow_list;
        config.services[name] = svc;
        saveConfig(ctx.configPath, config);
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: `Service "${name}" created. ChannelKit is restarting...` }] };
        }
        return { content: [{ type: 'text', text: `Service "${name}" created. Restart ChannelKit to activate.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'update_service',
    'Update an existing service. Requires restart to apply — set auto_restart to restart automatically.',
    {
      name: z.string().describe('Service name to update'),
      webhook: z.string().optional().describe('New webhook URL'),
      code: z.string().optional().describe('New magic code'),
      command: z.string().optional().describe('New slash command'),
      stt: z.object({
        provider: z.enum(['google', 'whisper', 'deepgram']),
        language: z.string().optional(),
        forward_audio: z.boolean().optional().describe('Send original audio to webhook along with transcription (default: false)'),
      }).optional().describe('New STT config'),
      tts: z.object({
        provider: z.enum(['google', 'elevenlabs', 'openai']),
        voice: z.string().optional(),
        language: z.string().optional(),
      }).optional().describe('New TTS config'),
      allow_list: z.array(z.string()).optional().describe('Allow list of sender identifiers. Pass empty array to remove restrictions.'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ name, webhook, code, command, stt, tts, allow_list, auto_restart }) => {
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
        if (allow_list !== undefined) {
          if (allow_list.length > 0) config.services[name].allow_list = allow_list;
          else delete config.services[name].allow_list;
        }
        saveConfig(ctx.configPath, config);
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: `Service "${name}" updated. ChannelKit is restarting...` }] };
        }
        return { content: [{ type: 'text', text: `Service "${name}" updated. Restart to apply changes.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  mcp.tool(
    'remove_service',
    'Remove a service from the configuration. Requires restart to apply — set auto_restart to restart automatically.',
    {
      name: z.string().describe('Service name to remove'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ name, auto_restart }) => {
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
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: `Service "${name}" removed. ChannelKit is restarting...` }] };
        }
        return { content: [{ type: 'text', text: `Service "${name}" removed. Restart to apply.` }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Status ─────────────────────────────────────────────────

  mcp.tool(
    'get_status',
    'Get ChannelKit status: connected channels, uptime, message stats, current version, and update availability',
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

      // Version info
      let version: any = {};
      if (ctx.updater) {
        try {
          const updateStatus = await ctx.updater.checkForUpdate();
          version = {
            mode: updateStatus.mode,
            current_version: updateStatus.currentVersion,
            latest_version: updateStatus.latestVersion,
            update_available: updateStatus.updateAvailable,
            behind_count: updateStatus.behindCount,
          };
        } catch {
          version = { current_version: ctx.updater.getCurrentVersion(), update_available: false };
        }
      } else {
        try {
          const { execSync } = await import('child_process');
          version.current_version = execSync('git rev-parse --short HEAD', { cwd: process.cwd(), encoding: 'utf-8' }).trim();
        } catch {
          version.current_version = 'unknown';
        }
      }

      const status = {
        uptime_ms: uptime,
        uptime_human: formatUptime(uptime),
        channels: channelStatus,
        messages: stats,
        public_url: ctx.getPublicUrl(),
        version,
      };
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  mcp.tool(
    'update',
    'Update ChannelKit to the latest version. Pulls latest changes (git) or installs latest package (npm), and restarts the process. The MCP connection will be lost after restart.',
    {},
    async () => {
      if (!ctx.updater) {
        return { content: [{ type: 'text', text: 'Updater not available' }], isError: true };
      }
      try {
        const result = await ctx.updater.performUpdate();
        if (result.success) {
          return { content: [{ type: 'text', text: `Update successful: ${result.previousVersion} -> ${result.newVersion}. ChannelKit is restarting... The MCP connection will reconnect shortly.` }] };
        }
        return { content: [{ type: 'text', text: `Update failed: ${result.error}` }], isError: true };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Update failed: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Restart ──────────────────────────────────────────────

  mcp.tool(
    'restart',
    'Restart the ChannelKit process. The MCP connection will be lost and should reconnect automatically.',
    {},
    async () => {
      setTimeout(() => restartProcess(ctx.channels), 500);
      return { content: [{ type: 'text', text: 'ChannelKit is restarting... The MCP connection will reconnect shortly.' }] };
    }
  );

  // ── Auth Module ──────────────────────────────────────────────

  mcp.tool(
    'get_auth_config',
    'Get the current WhatsApp auth module configuration. Returns enabled status, channel, callback URL, session settings, and custom messages.',
    {},
    async () => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set' }], isError: true };
      }
      const config = loadConfig(ctx.configPath, { validate: false });
      const auth = config.auth || null;
      if (!auth) {
        return { content: [{ type: 'text', text: 'Auth module is not configured. Use set_auth_config to enable it.' }] };
      }
      // Mask callback token
      const display = { ...auth };
      if (display.callback_auth?.token) {
        display.callback_auth = { ...display.callback_auth, token: '••••' + display.callback_auth.token.slice(-4) };
      }
      return { content: [{ type: 'text', text: JSON.stringify(display, null, 2) }] };
    }
  );

  mcp.tool(
    'set_auth_config',
    'Configure the WhatsApp auth module. Enables user verification via WhatsApp (phone+code and QR scan flows). When enabled, ChannelKit intercepts auth messages before normal routing and calls your callback URL on successful verification.',
    {
      enabled: z.boolean().describe('Enable or disable the auth module'),
      channel: z.string().optional().describe('WhatsApp channel name to use for auth messages'),
      channel_number: z.string().optional().describe('WhatsApp number override for wa.me QR links (e.g. +972501234567)'),
      callback_url: z.string().optional().describe('URL to POST when verification completes (receives phone, senderName, method)'),
      callback_token: z.string().optional().describe('Bearer token for authenticating callback requests'),
      session_ttl: z.number().optional().describe('Session timeout in seconds (default 300)'),
      code_length: z.number().optional().describe('Digits in phone verification code (default 6)'),
      qr_code_length: z.number().optional().describe('Characters in QR code (default 8)'),
      verify_message: z.string().optional().describe('Message sent to user asking them to reply with the code (phone flow)'),
      qr_link_prefix: z.string().optional().describe('Human-readable line prepended to LOGIN code in QR/link message (e.g. "Connect me to YourApp:")'),
      verify_success: z.string().optional().describe('Reply sent after successful verification (e.g. "✅ Connected! Go back to the page.")'),
      verify_error: z.string().optional().describe('Reply sent on wrong code when auth attempt is recognized (e.g. "Invalid code. Please try again.")'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart to apply changes'),
    },
    async ({ enabled, channel, channel_number, callback_url, callback_token, session_ttl, code_length, qr_code_length, verify_message, qr_link_prefix, verify_success, verify_error, auto_restart }) => {
      if (!ctx.configPath) {
        return { content: [{ type: 'text', text: 'Config path not set' }], isError: true };
      }
      try {
        const config = loadConfig(ctx.configPath, { validate: false });

        if (!enabled) {
          delete config.auth;
          saveConfig(ctx.configPath, config);
          if (auto_restart) {
            setTimeout(() => restartProcess(ctx.channels), 500);
            return { content: [{ type: 'text', text: 'Auth module disabled. ChannelKit is restarting...' }] };
          }
          return { content: [{ type: 'text', text: 'Auth module disabled. Restart to apply.' }] };
        }

        if (!config.auth) {
          config.auth = { enabled: true, channel: '', callback_url: '' };
        }
        config.auth.enabled = true;
        if (channel) config.auth.channel = channel;
        if (channel_number !== undefined) {
          if (channel_number) config.auth.channel_number = channel_number;
          else delete config.auth.channel_number;
        }
        if (callback_url) config.auth.callback_url = callback_url;
        if (callback_token) {
          config.auth.callback_auth = { type: 'bearer', token: callback_token };
        }
        if (session_ttl) config.auth.session_ttl = session_ttl;
        if (code_length) config.auth.code_length = code_length;
        if (qr_code_length) config.auth.qr_code_length = qr_code_length;
        // Update messages (merge with existing)
        const msgs: Record<string, string> = { ...(config.auth.messages || {}) };
        if (verify_message !== undefined) {
          if (verify_message) msgs.verify_request = verify_message;
          else delete msgs.verify_request;
        }
        if (qr_link_prefix !== undefined) {
          if (qr_link_prefix) msgs.qr_link_prefix = qr_link_prefix;
          else delete msgs.qr_link_prefix;
        }
        if (verify_success !== undefined) {
          if (verify_success) msgs.verify_success = verify_success;
          else delete msgs.verify_success;
        }
        if (verify_error !== undefined) {
          if (verify_error) msgs.verify_error = verify_error;
          else delete msgs.verify_error;
        }
        if (Object.keys(msgs).length > 0) {
          config.auth.messages = msgs;
        } else {
          delete config.auth.messages;
        }

        saveConfig(ctx.configPath, config);
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: 'Auth module configured. ChannelKit is restarting...' }] };
        }
        return { content: [{ type: 'text', text: 'Auth module configured. Restart to apply changes.' }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Configuration ───────────────────────────────────────────

  mcp.tool(
    'set_config',
    'Set a configuration value using a dot-separated path. Examples: set_config("apiPort", 5000), set_config("tunnel.expose_dashboard", true), set_config("settings.openai_api_key", "sk-..."), set_config("mcp.enabled", true). Changes are saved to config.yaml. Some changes require a restart to take effect.',
    {
      path: z.string().describe('Dot-separated config path (e.g. "apiPort", "tunnel.token", "settings.openai_api_key", "mcp.enabled")'),
      value: z.any().describe('Value to set (string, number, boolean, or null to delete the key)'),
      auto_restart: z.boolean().optional().default(false).describe('Automatically restart ChannelKit to apply changes'),
    },
    async ({ path, value, auto_restart }) => {
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
        if (auto_restart) {
          setTimeout(() => restartProcess(ctx.channels), 500);
          return { content: [{ type: 'text', text: `Set ${path} = ${display}. ChannelKit is restarting...` }] };
        }
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
