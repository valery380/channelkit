import { EventEmitter } from 'events';
import { ChannelConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from '../core/types';

export abstract class Channel extends EventEmitter {
  /** Whether this channel is currently connected and able to send messages. */
  public connected = true;

  constructor(
    public readonly name: string,
    protected config: ChannelConfig
  ) {
    super();
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(to: string, response: WebhookResponse): Promise<void>;

  /** Send a text message, optionally quoting another. Returns the sent message ID if supported. */
  sendToJid?(jid: string, text: string, quotedMessageId?: string): Promise<string | undefined>;

  /** React to a message with an emoji. */
  reactToMessage?(jid: string, messageId: string, emoji: string): Promise<void>;

  protected emitMessage(message: UnifiedMessage) {
    this.emit('message', message);
  }
}
