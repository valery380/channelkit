import { EventEmitter } from 'events';
import { ChannelConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from '../core/types';

export abstract class Channel extends EventEmitter {
  constructor(
    public readonly name: string,
    protected config: ChannelConfig
  ) {
    super();
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(to: string, response: WebhookResponse): Promise<void>;

  protected emitMessage(message: UnifiedMessage) {
    this.emit('message', message);
  }
}
