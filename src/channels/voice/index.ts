/**
 * Twilio Voice Channel
 * 
 * Flow:
 * 1. Incoming call → POST /inbound/voice/<channel>
 * 2. ChannelKit returns TwiML: greeting + record
 * 3. Recording done → POST /inbound/voice/<channel>/recording
 * 4. ChannelKit: STT → webhook → TTS → respond to caller
 * 5. If conversational: loop back to record
 */

import Twilio from 'twilio';
import { Channel } from '../base';
import { TwilioVoiceChannelConfig, ServiceConfig, VoiceServiceConfig } from '../../config/types';
import { UnifiedMessage, WebhookResponse } from '../../core/types';

// Pending calls waiting for webhook response
interface PendingCall {
  callSid: string;
  from: string;
  serviceConfig?: ServiceConfig;
}

export class TwilioVoiceChannel extends Channel {
  private client: ReturnType<typeof Twilio>;
  private pendingCalls: Map<string, PendingCall> = new Map();
  private publicUrl: string | null = null;

  constructor(name: string, config: TwilioVoiceChannelConfig) {
    super(name, config);
    this.client = Twilio(config.account_sid, config.auth_token);
  }

  private get cfg(): TwilioVoiceChannelConfig {
    return this.config as TwilioVoiceChannelConfig;
  }

  setPublicUrl(url: string): void {
    this.publicUrl = url;
  }

  async connect(): Promise<void> {
    try {
      const numbers = await this.client.incomingPhoneNumbers.list({ phoneNumber: this.cfg.number, limit: 1 });
      if (numbers.length > 0) {
        console.log(`✅ Twilio Voice connected: ${this.name} (${this.cfg.number})`);
      } else {
        console.warn(`⚠️  Twilio number ${this.cfg.number} not found in account.`);
      }
    } catch (err) {
      console.warn(`⚠️  Could not verify Twilio number: ${(err as Error).message}`);
    }

    if (!this.publicUrl) {
      console.log(`  📞 Waiting for public URL to configure voice webhook (use --tunnel or --public-url)`);
    }
  }

  async disconnect(): Promise<void> {
    // Nothing to disconnect
  }

  /**
   * Set the voice webhook URL on this Twilio number
   */
  async setWebhookUrl(url: string): Promise<void> {
    try {
      const numbers = await this.client.incomingPhoneNumbers.list({ phoneNumber: this.cfg.number, limit: 1 });
      if (numbers.length > 0) {
        await this.client.incomingPhoneNumbers(numbers[0].sid).update({
          voiceUrl: url,
          voiceMethod: 'POST',
        });
        console.log(`  📞 Updated Twilio voice webhook for ${this.cfg.number}`);
      }
    } catch (err) {
      console.error(`[voice:${this.name}] Failed to set webhook:`, err);
    }
  }

  /**
   * Handle incoming call — returns TwiML
   */
  handleIncomingCall(payload: any, voiceConfig?: VoiceServiceConfig): string {
    const callSid = payload.CallSid;
    const from = payload.From || '';
    const VoiceResponse = Twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const language = voiceConfig?.language || 'en-US';
    const voiceName = voiceConfig?.voice_name;
    const maxRecord = voiceConfig?.max_record_seconds || 30;

    // Store pending call
    this.pendingCalls.set(callSid, { callSid, from });

    // Greeting
    const greeting = voiceConfig?.greeting || 'Hello. Please speak after the beep.';
    const sayOpts: any = { language };
    if (voiceName) sayOpts.voice = voiceName;
    twiml.say(sayOpts, greeting);

    // Record
    const recordUrl = `${this.publicUrl}/inbound/voice/${this.name}/recording`;
    twiml.record({
      action: recordUrl,
      maxLength: maxRecord,
      playBeep: true,
      transcribe: false, // we do our own STT
    });

    // Fallback if no recording (caller hung up)
    twiml.say(sayOpts, 'No message received. Goodbye.');
    twiml.hangup();

    console.log(`[voice:${this.name}] Incoming call from ${from} (${callSid})`);
    return twiml.toString();
  }

  /**
   * Handle recording callback — downloads audio, emits as message
   */
  async handleRecording(payload: any, voiceConfig?: VoiceServiceConfig): Promise<string> {
    const callSid = payload.CallSid;
    const recordingUrl = payload.RecordingUrl;
    const from = payload.From || this.pendingCalls.get(callSid)?.from || '';

    const VoiceResponse = Twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const language = voiceConfig?.language || 'en-US';
    const voiceName = voiceConfig?.voice_name;
    const sayOpts: any = { language };
    if (voiceName) sayOpts.voice = voiceName;

    if (!recordingUrl) {
      twiml.say(sayOpts, voiceConfig?.hold_message || 'Sorry, no recording received. Goodbye.');
      twiml.hangup();
      return twiml.toString();
    }

    // Hold message or music while we process
    const holdMessage = voiceConfig?.hold_message;
    const holdMusic = voiceConfig?.hold_music;

    if (holdMessage) {
      twiml.say(sayOpts, holdMessage);
    } else if (holdMusic) {
      twiml.play(holdMusic);
    } else {
      twiml.pause({ length: 1 });
    }

    // Download recording audio
    try {
      const audioUrl = `${recordingUrl}.mp3`;
      const res = await fetch(audioUrl, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.cfg.account_sid}:${this.cfg.auth_token}`).toString('base64'),
        },
      });
      const buffer = Buffer.from(await res.arrayBuffer());

      // Emit as unified message — STT + webhook will be handled by the pipeline
      const unified: UnifiedMessage = {
        id: callSid + '-' + Date.now(),
        channel: 'voice',
        from,
        type: 'audio',
        text: undefined,
        timestamp: Math.floor(Date.now() / 1000),
        media: {
          buffer,
          mimetype: 'audio/mpeg',
        },
      };

      // Store call context for response routing
      (unified as any)._callSid = callSid;
      (unified as any)._voiceConfig = voiceConfig;

      this.emitMessage(unified);
    } catch (err) {
      console.error(`[voice:${this.name}] Failed to download recording:`, err);
      twiml.say(sayOpts, 'Sorry, there was an error processing your message. Goodbye.');
      twiml.hangup();
    }

    // Return hold TwiML — the actual response will come via the API
    // We need to use <Redirect> to poll for the response
    const redirectUrl = `${this.publicUrl}/inbound/voice/${this.name}/respond/${callSid}`;
    twiml.redirect({ method: 'POST' }, redirectUrl);

    return twiml.toString();
  }

  // Store responses from webhook for active calls
  private callResponses: Map<string, WebhookResponse> = new Map();

  /**
   * Store a webhook response for an active call
   */
  setCallResponse(callSid: string, response: WebhookResponse): void {
    this.callResponses.set(callSid, response);
  }

  /**
   * Handle respond redirect — check if webhook response is ready
   */
  handleRespond(callSid: string, voiceConfig?: VoiceServiceConfig): string {
    const VoiceResponse = Twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const language = voiceConfig?.language || 'en-US';
    const voiceName = voiceConfig?.voice_name;
    const sayOpts: any = { language };
    if (voiceName) sayOpts.voice = voiceName;

    const response = this.callResponses.get(callSid);

    if (!response) {
      // Not ready yet — wait and redirect again
      const holdMessage = voiceConfig?.hold_message;
      const holdMusic = voiceConfig?.hold_music;
      if (holdMusic) {
        twiml.play(holdMusic);
      } else if (holdMessage) {
        twiml.say(sayOpts, holdMessage);
      } else {
        twiml.pause({ length: 2 });
      }
      const redirectUrl = `${this.publicUrl}/inbound/voice/${this.name}/respond/${callSid}`;
      twiml.redirect({ method: 'POST' }, redirectUrl);
      return twiml.toString();
    }

    // Response ready — play it
    this.callResponses.delete(callSid);

    if (response.media?.buffer && response.media.mimetype?.includes('audio')) {
      // TTS audio — need to serve it somehow
      // For now, fall back to text via <Say>
      if (response.text) {
        twiml.say(sayOpts, response.text);
      }
    } else if (response.text) {
      twiml.say(sayOpts, response.text);
    }

    // Conversational mode: loop back to record
    if (voiceConfig?.conversational) {
      const maxRecord = voiceConfig.max_record_seconds || 30;
      const recordUrl = `${this.publicUrl}/inbound/voice/${this.name}/recording`;
      twiml.record({
        action: recordUrl,
        maxLength: maxRecord,
        playBeep: true,
        transcribe: false,
      });
      twiml.say(sayOpts, 'Goodbye.');
    }

    twiml.hangup();

    // Clean up
    this.pendingCalls.delete(callSid);

    return twiml.toString();
  }

  // send() is not used for voice — responses go through TwiML
  async send(_to: string, response: WebhookResponse): Promise<void> {
    // Voice responses are handled via setCallResponse + TwiML redirect
    // This is a no-op but required by the Channel interface
    console.log(`[voice:${this.name}] send() called — voice uses TwiML flow, not direct send`);
  }
}
