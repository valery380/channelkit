import { Boom } from '@hapi/boom';
import { join } from 'path';
import { Channel } from '../base';
import { WhatsAppChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';
import { DEFAULT_AUTH_DIR } from '../../paths';

let baileys: typeof import('@whiskeysockets/baileys') | null = null;

async function loadBaileys() {
  if (!baileys) {
    try {
      baileys = await import('@whiskeysockets/baileys');
    } catch {
      throw new Error(
        'WhatsApp support requires @whiskeysockets/baileys.\n' +
        'Install it with: npm install @whiskeysockets/baileys\n\n' +
        'Note: @whiskeysockets/baileys is licensed under GPL-3.0.'
      );
    }
  }
  return baileys;
}

export function isBaileysAvailable(): boolean {
  try {
    require.resolve('@whiskeysockets/baileys');
    return true;
  } catch {
    return false;
  }
}

export class WhatsAppChannel extends Channel {
  private processedIds: Set<string> = new Set();
  /**
   * Pair a new WhatsApp device by showing a QR code.
   * Creates a temporary Baileys connection, waits for successful pairing, then disconnects.
   * Auth state is persisted to authDir for later use by connect().
   */
  static async pair(authDir: string, onQR?: (qr: string) => void): Promise<void> {
    const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason, default: makeWASocket } = await loadBaileys();
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

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
      },
      logger: silentLogger as any,
      browser: ['ChannelKit', 'Desktop', '1.0.0'],
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sock.end(undefined);
        reject(new Error('QR pairing timed out after 60s'));
      }, 60000);

      sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          if (onQR) onQR(qr);
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

  private sock: any = null;
  private authDir: string;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(name: string, config: WhatsAppChannelConfig, authDir = DEFAULT_AUTH_DIR) {
    super(name, config);
    this.connected = false; // WhatsApp channels start disconnected until Baileys connects
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
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  getSocket(): any {
    return this.sock;
  }

  async createGroup(name: string, participants: string[]): Promise<{ id: string; subject: string }> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const result = await this.sock.groupCreate(name, participants);
    return { id: result.id, subject: name };
  }

  async groupUpdateDescription(groupId: string, description: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.groupUpdateDescription(groupId, description);
  }

  async groupUpdateSubject(groupId: string, subject: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.groupUpdateSubject(groupId, subject);
  }

  async groupUpdatePhoto(groupId: string, image: Buffer): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    await this.sock.updateProfilePicture(groupId, image);
  }

  async groupInviteCode(groupId: string): Promise<string> {
    if (!this.sock) throw new Error('WhatsApp not connected');
    const code = await this.sock.groupInviteCode(groupId);
    if (!code) throw new Error('Failed to get invite code');
    return code;
  }

  async sendToJid(jid: string, text: string): Promise<void> {
    if (!this.sock) return;
    await this.sock.sendMessage(jid, { text });
  }

  async connect(): Promise<void> {
    this.reconnectAttempts = 0;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage, DisconnectReason, default: makeWASocket } = await loadBaileys();
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

    const { version } = await fetchLatestBaileysVersion();
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as any),
      },
      logger: silentLogger as any,
      browser: ['ChannelKit', 'Desktop', '1.0.0'],
      syncFullHistory: false,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update: any) => {
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
        this.connected = false;
        this.emit('disconnected');
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          this.scheduleReconnect();
        } else {
          console.log(`[whatsapp:${this.name}] Logged out`);
        }
      } else if (connection === 'open') {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
        console.log(`✅ WhatsApp connected: ${this.name}`);
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }: { messages: any[] }) => {
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const msgId = msg.key.id;
        if (msgId && this.processedIds.has(msgId)) continue;
        if (msgId) this.processedIds.add(msgId);

        // Keep set bounded
        if (this.processedIds.size > 1000) {
          const arr = [...this.processedIds];
          this.processedIds = new Set(arr.slice(-500));
        }
        // Resolve LID to regular JID
        if (msg.key.remoteJid?.endsWith('@lid') && (msg.key as any).remoteJidAlt) {
          msg.key.remoteJid = (msg.key as any).remoteJidAlt;
        }
        const unified = this.toUnified(msg, (msg as any).pushName);
        if (!unified) continue;

        // Download media for messages with media content
        const mediaTypes = ['audio', 'image', 'video', 'document', 'sticker'] as const;
        if ((mediaTypes as readonly string[]).includes(unified.type) && msg.message) {
          try {
            const content = msg.message;
            let mimetype: string | undefined;
            let filename: string | undefined;

            if (content.audioMessage) {
              mimetype = content.audioMessage.mimetype || 'audio/ogg; codecs=opus';
            } else if (content.imageMessage) {
              mimetype = content.imageMessage.mimetype || 'image/jpeg';
            } else if (content.videoMessage) {
              mimetype = content.videoMessage.mimetype || 'video/mp4';
            } else if (content.documentMessage) {
              mimetype = content.documentMessage.mimetype || 'application/octet-stream';
              filename = content.documentMessage.fileName || undefined;
            } else if (content.stickerMessage) {
              mimetype = content.stickerMessage.mimetype || 'image/webp';
            }

            if (mimetype) {
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              console.log(`[whatsapp:${this.name}] Downloaded ${unified.type}: ${(buffer as Buffer).length} bytes, ${mimetype}`);
              unified.media = { buffer: buffer as Buffer, mimetype, filename };
            }
          } catch (err) {
            console.error(`[whatsapp:${this.name}] Failed to download ${unified.type} media:`, err);
          }
        }

        this.emitMessage(unified);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = WhatsAppChannel.MAX_RECONNECT_ATTEMPTS; // prevent further reconnects
    this.sock?.end(undefined);
    this.sock = null;
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    if (!this.sock || !this.connected) {
      throw new Error('WhatsApp channel is not connected');
    }

    // Voice message from buffer (TTS output)
    if (response.media?.buffer && response.media.mimetype?.includes('audio')) {
      const mime = response.media.mimetype;
      // WhatsApp voice notes (ptt) require OGG/Opus — other formats (e.g. MP3) are sent as audio files
      const isOggOpus = mime.includes('ogg') || mime.includes('opus');
      await this.sock.sendMessage(to, {
        audio: response.media.buffer,
        mimetype: mime,
        ptt: isOggOpus,
      } as any);
      // If there was also text, don't send it separately (voice replaces text)
      return;
    }

    if (response.text) {
      await this.sock.sendMessage(to, { text: response.text });
    }
    if (response.media?.buffer && response.media.mimetype) {
      // Non-audio buffer (e.g. PDF from webhook response)
      const mime = response.media.mimetype;
      const type = mime.startsWith('image') ? 'image' : 'document';
      await this.sock.sendMessage(to, {
        [type]: response.media.buffer,
        mimetype: mime,
      } as any);
    } else if (response.media?.url) {
      const type = response.media.mimetype?.startsWith('image') ? 'image' : 'document';
      await this.sock.sendMessage(to, {
        [type]: { url: response.media.url },
        mimetype: response.media.mimetype,
      } as any);
    }
  }

  private toUnified(msg: any, pushName?: string): UnifiedMessage | null {
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
    // Resolve participant: key.participant is primary, msg.participant is fallback
    const participant = key.participant || msg.participant || undefined;

    return {
      id: key.id || `${Date.now()}`,
      channel: 'whatsapp',
      from: isGroup ? (participant || jid) : jid,
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
