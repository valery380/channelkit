import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { join } from 'path';
import { Channel } from '../base';
import { WhatsAppChannelConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

export class WhatsAppChannel extends Channel {
  private sock: WASocket | null = null;
  private authDir: string;

  constructor(name: string, config: WhatsAppChannelConfig, authDir = './auth') {
    super(name, config);
    this.authDir = join(authDir, `whatsapp-${name}`);
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
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
          console.log(`[whatsapp:${this.name}] Reconnecting...`);
          this.connect();
        } else {
          console.log(`[whatsapp:${this.name}] Logged out`);
        }
      } else if (connection === 'open') {
        console.log(`✅ WhatsApp connected: ${this.name}`);
      }
    });

    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const unified = this.toUnified(msg);
        if (unified) this.emitMessage(unified);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.sock?.end(undefined);
    this.sock = null;
  }

  async send(to: string, response: WebhookResponse): Promise<void> {
    if (!this.sock) return;
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

  private toUnified(msg: proto.IWebMessageInfo): UnifiedMessage | null {
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
      groupId: isGroup ? jid : undefined,
      groupName: undefined,
    };
  }
}
