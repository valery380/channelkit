import Twilio from 'twilio';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  isoCountry: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
}

export interface PurchasedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
}

export class TwilioProvisioner {
  private client: ReturnType<typeof Twilio>;

  constructor(config: TwilioConfig) {
    this.client = Twilio(config.accountSid, config.authToken);
  }

  async searchNumbers(countryCode: string, options?: { type?: 'mobile' | 'local'; limit?: number }): Promise<AvailableNumber[]> {
    const type = options?.type || 'mobile';
    const limit = options?.limit || 5;

    try {
      let results;
      if (type === 'mobile') {
        results = await this.client.availablePhoneNumbers(countryCode).mobile.list({
          smsEnabled: true,
          limit,
        });
      } else {
        results = await this.client.availablePhoneNumbers(countryCode).local.list({
          smsEnabled: true,
          limit,
        });
      }

      return results.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        isoCountry: n.isoCountry,
        capabilities: {
          sms: n.capabilities.sms || false,
          mms: n.capabilities.mms || false,
          voice: n.capabilities.voice || false,
        },
      }));
    } catch (err: any) {
      throw new Error(`Failed to search numbers: ${err.message}`);
    }
  }

  async purchaseNumber(phoneNumber: string): Promise<PurchasedNumber> {
    try {
      const result = await this.client.incomingPhoneNumbers.create({
        phoneNumber,
      });

      return {
        sid: result.sid,
        phoneNumber: result.phoneNumber,
        friendlyName: result.friendlyName,
      };
    } catch (err: any) {
      throw new Error(`Failed to purchase number: ${err.message}`);
    }
  }

  /**
   * Read incoming SMS for a number (for WhatsApp verification).
   * Sets up a webhook temporarily to capture the verification code.
   */
  async waitForSms(numberSid: string, timeoutMs = 60000): Promise<string> {
    const startTime = Date.now();

    // Poll for messages
    while (Date.now() - startTime < timeoutMs) {
      const messages = await this.client.messages.list({
        to: undefined, // will filter below
        limit: 5,
      });

      // Look for recent WhatsApp verification messages
      for (const msg of messages) {
        const age = Date.now() - new Date(msg.dateCreated).getTime();
        if (age < timeoutMs && msg.body) {
          const codeMatch = msg.body.match(/(\d{6})/);
          if (codeMatch) {
            return codeMatch[1];
          }
        }
      }

      // Wait 3 seconds before polling again
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error('Timeout waiting for SMS verification code');
  }

  async releaseNumber(numberSid: string): Promise<void> {
    try {
      await this.client.incomingPhoneNumbers(numberSid).remove();
    } catch (err: any) {
      throw new Error(`Failed to release number: ${err.message}`);
    }
  }
}
