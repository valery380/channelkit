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
  price?: string;
  priceUnit?: string;
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

  async searchNumbers(countryCode: string, options?: { type?: 'mobile' | 'local'; limit?: number; smsEnabled?: boolean; voiceEnabled?: boolean }): Promise<AvailableNumber[]> {
    const type = options?.type || 'mobile';
    const limit = options?.limit || 5;
    const smsEnabled = options?.smsEnabled ?? true;
    const voiceEnabled = options?.voiceEnabled ?? true;

    try {
      const filters: Record<string, any> = { limit };
      if (smsEnabled) filters.smsEnabled = true;
      if (voiceEnabled) filters.voiceEnabled = true;

      let results;
      if (type === 'mobile') {
        results = await this.client.availablePhoneNumbers(countryCode).mobile.list(filters);
      } else {
        results = await this.client.availablePhoneNumbers(countryCode).local.list(filters);
      }

      // Fetch pricing for this country/type
      let price: string | undefined;
      let priceUnit: string | undefined;
      try {
        const pricing = await this.client.pricing.v1.phoneNumbers.countries(countryCode).fetch();
        // SDK passes raw API objects — inner keys are snake_case despite type declarations
        const match = pricing.phoneNumberPrices?.find(
          (p: any) => p.number_type === type,
        );
        if (match) {
          price = String((match as any).current_price ?? (match as any).base_price);
          priceUnit = pricing.priceUnit;
        }
      } catch (_) {
        // Pricing API may not be available — continue without price
      }

      return results.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        isoCountry: n.isoCountry,
        capabilities: {
          // Trust the filter we sent — if we asked for smsEnabled/voiceEnabled,
          // the number supports it even if Twilio's capabilities object disagrees.
          sms: smsEnabled || (n.capabilities.sms || false),
          mms: n.capabilities.mms || false,
          voice: voiceEnabled || (n.capabilities.voice || false),
        },
        price,
        priceUnit,
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
      // If a regulatory bundle is required, try to find an approved one and retry
      if (err.code === 21725 || /bundle required/i.test(err.message)) {
        const bundleSid = await this.findApprovedBundle();
        if (!bundleSid) {
          throw new Error(
            'This country requires a regulatory bundle. Create one at https://console.twilio.com/us1/develop/phone-numbers/manage/regulatory-compliance/bundles then try again.',
          );
        }
        try {
          const result = await this.client.incomingPhoneNumbers.create({
            phoneNumber,
            bundleSid,
          });
          return {
            sid: result.sid,
            phoneNumber: result.phoneNumber,
            friendlyName: result.friendlyName,
          };
        } catch (retryErr: any) {
          throw new Error(`Failed to purchase number: ${retryErr.message}`);
        }
      }
      throw new Error(`Failed to purchase number: ${err.message}`);
    }
  }

  private async findApprovedBundle(): Promise<string | undefined> {
    try {
      const bundles = await this.client.numbers.v2.regulatoryCompliance.bundles.list({
        status: 'twilio-approved',
        limit: 1,
      });
      return bundles[0]?.sid;
    } catch (_) {
      return undefined;
    }
  }

  /**
   * Poll Twilio for incoming SMS to a specific number.
   * Returns the 6-digit verification code when found.
   */
  async waitForSms(phoneNumber: string, timeoutMs = 120000, onPoll?: () => void): Promise<string> {
    const startTime = Date.now();
    const sentAfter = new Date(startTime - 5000); // small buffer

    while (Date.now() - startTime < timeoutMs) {
      if (onPoll) onPoll();

      try {
        const messages = await this.client.messages.list({
          to: phoneNumber,
          dateSentAfter: sentAfter,
          limit: 10,
        });

        for (const msg of messages) {
          if (msg.body) {
            // Match WhatsApp verification codes (6 digits, or "xxx-xxx" format)
            const codeMatch = msg.body.match(/(\d{3})-?(\d{3})/);
            if (codeMatch) {
              return codeMatch[1] + codeMatch[2];
            }
          }
        }
      } catch (err) {
        // Ignore polling errors, keep trying
      }

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
