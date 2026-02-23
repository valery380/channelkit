/**
 * MediaProcessor: handles STT/TTS for the message pipeline
 * 
 * Inbound:  voice message → STT → adds text to UnifiedMessage
 * Outbound: webhook returns { voice: true } → TTS → sends audio
 */

import { ServiceConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from '../core/types';
import { createSTTProvider, STTProvider } from './stt';
import { createTTSProvider, TTSProvider } from './tts';

interface ProcessorCache {
  stt: Map<string, STTProvider>;   // key = provider+language
  tts: Map<string, TTSProvider>;   // key = provider+voice
}

const cache: ProcessorCache = {
  stt: new Map(),
  tts: new Map(),
};

function getSTT(config: ServiceConfig): STTProvider | null {
  if (!config.stt) return null;
  const key = `${config.stt.provider}:${config.stt.language || ''}`;
  if (!cache.stt.has(key)) {
    cache.stt.set(key, createSTTProvider(config.stt));
  }
  return cache.stt.get(key)!;
}

function getTTS(config: ServiceConfig): TTSProvider | null {
  if (!config.tts) return null;
  const key = `${config.tts.provider}:${config.tts.voice || ''}`;
  if (!cache.tts.has(key)) {
    cache.tts.set(key, createTTSProvider(config.tts));
  }
  return cache.tts.get(key)!;
}

/**
 * Process inbound message: if it's audio and STT is configured, transcribe it.
 * Mutates the message in place (adds text field).
 */
export async function processInbound(message: UnifiedMessage, serviceConfig: ServiceConfig): Promise<void> {
  if (message.type !== 'audio' || !serviceConfig.stt) return;
  if (!message.media?.buffer) {
    console.log(`[stt] Audio message ${message.id} has no buffer — skipping transcription`);
    return;
  }

  const stt = getSTT(serviceConfig);
  if (!stt) return;

  try {
    const mimetype = message.media.mimetype || 'audio/ogg';
    console.log(`[stt] Transcribing message ${message.id} (${mimetype}, ${message.media.buffer.length} bytes)...`);
    const transcript = await stt.transcribe(message.media.buffer, mimetype, serviceConfig.stt.language);
    if (transcript) {
      message.text = transcript;
      console.log(`[stt] Transcribed: "${transcript.substring(0, 80)}${transcript.length > 80 ? '...' : ''}"`);
    } else {
      console.log(`[stt] Empty transcription for message ${message.id}`);
    }
  } catch (err) {
    console.error(`[stt] Transcription failed for message ${message.id}:`, err);
  }
}

export interface OutboundResult {
  response: WebhookResponse;
  ttsError?: string;
}

/**
 * Process outbound response: if TTS is configured on the service, synthesize audio.
 * Returns the response (with media buffer on success) and any TTS error.
 */
export async function processOutbound(response: WebhookResponse, serviceConfig: ServiceConfig): Promise<OutboundResult> {
  // Synthesize when TTS is configured on the service, unless the webhook explicitly opted out (voice: false)
  if (response.voice === false || !response.text || !serviceConfig.tts) return { response };

  const tts = getTTS(serviceConfig);
  if (!tts) return { response };

  try {
    console.log(`[tts] Synthesizing: "${response.text.substring(0, 80)}${response.text.length > 80 ? '...' : ''}"`);
    const { buffer, mimetype } = await tts.synthesize(response.text, serviceConfig.tts.voice);
    console.log(`[tts] Synthesized ${buffer.length} bytes (${mimetype})`);

    return {
      response: { ...response, media: { buffer, mimetype } },
    };
  } catch (err: any) {
    console.error(`[tts] Synthesis failed:`, err);
    const errMsg = err?.message || String(err);
    return { response, ttsError: errMsg.substring(0, 300) };
  }
}
