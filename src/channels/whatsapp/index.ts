import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { join } from 'path';
import { Channel } from '../base';
import { WhatsAppChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

export class WhatsAppChannel extends Channel {
  /**
   * Pair a new WhatsApp device by showing a QR code.
   * Creates a temporary Baileys connection, waits for successful pairing, then disconnects.
   * Auth state is persisted to authDir for later use by connect().
   */
  static async pair(authDir: string): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Check if already paired (has registered creds)
    const alreadyPaired = state.creds.registered;

    // Silent logger to suppress Baileys noise during pairing
    const silentLogger = {
      level: 'silent' as const,
      child: () => silentLogger,
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    };

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
      },
      logger: silentLogger as any,
    });

    sock.ev.on('creds.update', saveCreds);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sock.end(undefined);
        reject(new Error('QR pairing timed out after 60s'));
      }, 60000);

      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          import('qrcode-terminal').then(({ default: qrcode }) => {
            qrcode.generate(qr, { small: true }, (output: string) => {
              const indented = output.split('\n').map(line => '     ' + line).join('\n');
              console.log(indented);
            });
          }).catch(() => {
            console.log(`\n  📱 QR Code: ${qr}\n`);
          });
        }

        if (connection === 'open') {
          clearTimeout(timeout);
          sock.end(undefined);
          resolve();
        }

        if (connection === 'close') {
          const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
          if (reason === DisconnectReason.loggedOut) {
            clearTimeout(timeout);
            sock.end(undefined);
            reject(new Error('WhatsApp logged out during pairing'));
          }
          // If already paired and connection closed normally, that's fine
          if (alreadyPaired) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });
  }

  private sock: WASocket | null = null;
  private authDir: string;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(name: string, config: WhatsAppChannelConfig, authDir = './auth') {
    super(name, config);
    this.authDir = join(authDir, `whatsapp-${name}`);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= WhatsAppChannel.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[whatsapp:${this.name}] Giving up after ${WhatsAppChannel.MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
      return;
    }
    const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30000);
    this.reconnectAttempts++;
    console.log(`[whatsapp:${this.name}] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${WhatsAppChannel.MAX_RECONNECT_ATTEMPTS})...`);
    setTimeout(() => this.connect(), delay);
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  async createGroup(name: string, participants: string[]): Promise<{ id: string; subject: string }> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const result = await this.sock.groupCreate(name, participants);
    return { id: result.id, subject: name };
  }

  async sendToJid(jid: string, text: string): Promise<void> {
    if (!this.sock) return;
    await this.sock.sendMessage(jid, { text });
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    const silentLogger = {
      level: 'silent' as const,
      child: () => silentLogger,
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    };

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
      },
      logger: silentLogger as any,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        // Emit QR event for dashboard/API
        this.emit('qr', qr);

        // Dynamic import to handle optional dependency
        import('qrcode-terminal').then(({ default: qrcode }) => {
          console.log(`\n  📱 Scan this QR code with WhatsApp:\n`);
          qrcode.generate(qr, { small: true }, (output: string) => {
            // Indent the QR code
            const indented = output.split('\n').map(line => '     ' + line).join('\n');
            console.log(indented);
          });
          console.log(`\n  ${'\x1b[2m'}Open WhatsApp → Settings → Linked Devices → Link a Device${'\x1b[0m'}\n`);
        }).catch(() => {
          // Fallback: print raw QR string
          console.log(`\n  📱 QR Code (scan with WhatsApp):\n`);
          console.log(`  ${qr}\n`);
          console.log(`  Tip: install qrcode-terminal for a scannable QR in the terminal\n`);
        });
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          this.scheduleReconnect();
        } else {
          console.log(`[whatsapp:${this.name}] Logged out`);
        }
      } else if (connection === 'open') {
        this.reconnectAttempts = 0;
        console.log(`✅ WhatsApp connected: ${this.name}`);
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        // Resolve LID to regular JID
        if (msg.key.remoteJid?.endsWith('@lid') && (msg.key as any).remoteJidAlt) {
          msg.key.remoteJid = (msg.key as any).remoteJidAlt;
        }
        const unified = this.toUnified(msg, (msg as any).pushName);
        if (!unified) continue;

        // Download media for audio/voice messages
        if (unified.type === 'audio' && msg.message?.audioMessage) {
          try {
            const am = msg.message.audioMessage;
            console.log(`[whatsapp:${this.name}] audioMessage: fileLength=${am.fileLength}, seconds=${am.seconds}, url=${am.url ? 'yes' : 'no'}, directPath=${am.directPath ? 'yes' : 'no'}, mediaKey=${am.mediaKey ? 'yes' : 'no'}`);
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            const mimetype = msg.message.audioMessage.mimetype || 'audio/ogg; codecs=opus';
            const seconds = msg.message.audioMessage.seconds || 0;
            console.log(`[whatsapp:${this.name}] Downloaded audio: ${(buffer as Buffer).length} bytes, ${seconds}s, ${mimetype}`);
            unified.media = { buffer: buffer as Buffer, mimetype };
          } catch (err) {
            console.error(`[whatsapp:${this.name}] Failed to download audio:`, err);
          }
        }

        this.emitMessage(unified);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.sock?.end(undefined);
    this.sock = null;
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    if (!this.sock) return;

    // Voice message from buffer (TTS output)
    if (response.media?.buffer && response.media.mimetype?.includes('audio')) {
      await this.sock.sendMessage(to, {
        audio: response.media.buffer,
        mimetype: response.media.mimetype,
        ptt: true, // sends as voice note
      } as any);
      // If there was also text, don't send it separately (voice replaces text)
      return;
    }

    if (response.text) {
      await this.sock.sendMessage(to, { text: response.text });
    }
    if (response.media?.url) {
      const type = response.media.mimetype?.startsWith('image') ? 'image' : 'document';
      await this.sock.sendMessage(to, {
        [type]: { url: response.media.url },
        mimetype: response.media.mimetype,
      } as any);
    }
  }

  private toUnified(msg: proto.IWebMessageInfo, pushName?: string): UnifiedMessage | null {
    const key = msg.key!;
    const jid = key.remoteJid;
    if (!jid) return null;

    const content = msg.message;
    if (!content) return null;

    const text =
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      '';

    const isGroup = jid.endsWith('@g.us');

    return {
      id: key.id || `${Date.now()}`,
      channel: 'whatsapp',
      from: isGroup ? (key.participant || jid) : jid,
      type: content.imageMessage
        ? 'image'
        : content.audioMessage
          ? 'audio'
          : content.videoMessage
            ? 'video'
            : content.documentMessage
              ? 'document'
              : content.stickerMessage
                ? 'sticker'
                : 'text',
      text: text || undefined,
      timestamp: (msg.messageTimestamp as number) || Math.floor(Date.now() / 1000),
      replyTo: content.extendedTextMessage?.contextInfo?.stanzaId || undefined,
      senderName: pushName || undefined,
      groupId: isGroup ? jid : undefined,
      groupName: undefined,
    };
  }
}
