import { Bot, Context, InputFile } from 'grammy';
import { Channel } from '../base';
import { TelegramChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

export class TelegramChannel extends Channel {
  private bot: Bot | null = null;

  constructor(name: string, config: TelegramChannelConfig) {
    super(name, config);
  }

  private get token(): string {
    return (this.config as TelegramChannelConfig).bot_token;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.token);

    this.bot.on('message', (ctx) => {
      const unified = this.toUnified(ctx);
      if (unified) this.emitMessage(unified);
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
