import { Channel } from '../base';
import { TelegramChannelConfig } from '../../config/types';
import { WebhookResponse } from '../../core/types';

export class TelegramChannel extends Channel {
  constructor(name: string, config: TelegramChannelConfig) {
    super(name, config);
  }

  async connect(): Promise<void> {
    console.log(`⏳ Telegram channel "${this.name}" is a placeholder — not yet implemented`);
  }

  async disconnect(): Promise<void> {}

  async send(_to: string, _response: WebhookResponse): Promise<void> {
    throw new Error('Telegram channel not yet implemented');
  }
}
