import { Bot, Context, InputFile } from 'grammy';
import { Channel } from '../base';
import { TelegramChannelConfig, ServiceConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

interface SlashCommandService {
  command: string;       // without /
  serviceName: string;
  webhook: string;
}

export class TelegramChannel extends Channel {
  private bot: Bot | null = null;
  private slashCommands: SlashCommandService[] = [];
  // userId → active service webhook (for multi-service routing)
  private activeService: Map<string, string> = new Map();

  constructor(name: string, config: TelegramChannelConfig) {
    super(name, config);
  }

  private get token(): string {
    return (this.config as TelegramChannelConfig).bot_token;
  }

  /**
   * Register slash commands for multi-service mode.
   * Called by ChannelKit after router is set up.
   */
  setSlashCommands(services: { name: string; config: ServiceConfig }[]): void {
    this.slashCommands = services
      .filter(s => s.config.command)
      .map(s => ({
        command: s.config.command!.replace(/^\//, ''),
        serviceName: s.name,
        webhook: s.config.webhook,
      }));
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.token);

    // Register slash commands with Telegram if we have any
    if (this.slashCommands.length > 0) {
      await this.bot.api.setMyCommands(
        this.slashCommands.map(sc => ({
          command: sc.command,
          description: sc.serviceName,
        }))
      );
      console.log(`  📋 Registered ${this.slashCommands.length} slash command(s): ${this.slashCommands.map(sc => '/' + sc.command).join(', ')}`);
    }

    this.bot.on('message', async (ctx) => {
      const text = ctx.message?.text || '';

      // Check if it's a slash command for service switching
      if (text.startsWith('/') && this.slashCommands.length > 0) {
        const cmd = text.split(/[@\s]/)[0].slice(1).toLowerCase();
        const match = this.slashCommands.find(sc => sc.command.toLowerCase() === cmd);
        if (match) {
          const userId = ctx.message!.from!.id.toString();
          this.activeService.set(userId, match.webhook);
          ctx.reply(`✅ Switched to ${match.serviceName}. Send your messages now.`);
          console.log(`[telegram] User ${userId} switched to service: ${match.serviceName}`);
          return;
        }
        // /start command — show available services
        if (cmd === 'start' && this.slashCommands.length > 0) {
          const lines = this.slashCommands.map(sc => `/${sc.command} — ${sc.serviceName}`);
          ctx.reply(`Available services:\n\n${lines.join('\n')}\n\nTap a command to get started.`);
          return;
        }
      }

      const unified = this.toUnified(ctx);
      if (!unified) return;

      // Download audio/voice for STT
      if (unified.type === 'audio' && (ctx.message?.voice || ctx.message?.audio)) {
        try {
          const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;
          if (fileId) {
            const file = await ctx.api.getFile(fileId);
            const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
            const res = await fetch(url);
            const buffer = Buffer.from(await res.arrayBuffer());
            const mimetype = ctx.message.voice?.mime_type || ctx.message.audio?.mime_type || 'audio/ogg';
            unified.media = { buffer, mimetype };
          }
        } catch (err) {
          console.error(`[telegram:${this.name}] Failed to download audio:`, err);
        }
      }

      // In multi-service mode, attach the active webhook so router can use it
      if (this.slashCommands.length > 0) {
        const userId = ctx.message!.from!.id.toString();
        const activeWebhook = this.activeService.get(userId);
        if (activeWebhook) {
          (unified as any)._resolvedWebhook = activeWebhook;
        } else {
          // No active service — prompt user to pick one
          const lines = this.slashCommands.map(sc => `/${sc.command} — ${sc.serviceName}`);
          ctx.reply(`Please choose a service first:\n\n${lines.join('\n')}`);
          return;
        }
      }

      this.emitMessage(unified);
    });

    // Log unhandled middleware errors
    this.bot.catch((err) => {
      console.error(`[telegram:${this.name}] Unhandled error:`, err.message || err);
    });

    // Start polling in background (don't await — it blocks)
    this.bot.start({
      onStart: (botInfo) => {
        console.log(`✅ Telegram connected: ${this.name} (@${botInfo.username})`);
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
  }

  async sendToChat(chatId: string, text: string): Promise<void> {
    if (!this.bot) return;
    const id = parseInt(chatId, 10) || chatId;
    await this.bot.api.sendMessage(id, text);
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    if (!this.bot) return;
    const chatId = parseInt(to, 10) || to;

    // Voice message from buffer (TTS output)
    if (response.media?.buffer && response.media.mimetype?.includes('audio')) {
      await this.bot.api.sendVoice(chatId, new InputFile(response.media.buffer, 'voice.ogg'));
      return;
    }

    if (response.text) {
      await this.bot.api.sendMessage(chatId, response.text);
    }

    if (response.media?.url) {
      const mime = response.media.mimetype || '';
      if (mime.startsWith('image')) {
        await this.bot.api.sendPhoto(chatId, response.media.url);
      } else if (mime.startsWith('audio')) {
        await this.bot.api.sendAudio(chatId, response.media.url);
      } else if (mime.startsWith('video')) {
        await this.bot.api.sendVideo(chatId, response.media.url);
      } else {
        await this.bot.api.sendDocument(chatId, response.media.url);
      }
    }
  }

  private toUnified(ctx: Context): UnifiedMessage | null {
    const msg = ctx.message;
    if (!msg) return null;

    const chatId = msg.chat.id.toString();
    const from = msg.from;
    const senderName = from
      ? [from.first_name, from.last_name].filter(Boolean).join(' ')
      : undefined;

    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    const text =
      msg.text ||
      msg.caption ||
      '';

    let type: UnifiedMessage['type'] = 'text';
    if (msg.photo && msg.photo.length > 0) type = 'image';
    else if (msg.document) type = 'document';
    else if (msg.audio) type = 'audio';
    else if (msg.video) type = 'video';
    else if (msg.voice) type = 'audio';
    else if (msg.video_note) type = 'video';
    else if (msg.sticker) type = 'sticker';
    else if (msg.location) type = 'location';

    return {
      id: msg.message_id.toString(),
      channel: 'telegram',
      from: chatId,
      type,
      text: text || undefined,
      timestamp: msg.date,
      replyTo: msg.reply_to_message?.message_id?.toString() || undefined,
      senderName,
      groupId: isGroup ? chatId : undefined,
      groupName: isGroup
        ? ('title' in msg.chat ? (msg.chat as any).title : undefined)
        : undefined,
    };
  }
}
