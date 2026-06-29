/**
 * MediaProcessor: handles STT/TTS/AI-formatting for the message pipeline
 *
 * Inbound:  voice message → STT → AI format → adds text to UnifiedMessage
 * Outbound: webhook returns { voice: true } → TTS → sends audio
 */

import { ServiceConfig } from '../config/types';
import { UnifiedMessage, WebhookResponse } from '../core/types';
import { createSTTProvider, STTProvider } from './stt';
import { createTTSProvider, TTSProvider } from './tts';
import { createFormatProvider, FormatProvider } from './formatter';
import { translate as runTranslate } from './translator';

interface ProcessorCache {
  stt: Map<string, STTProvider>;       // key = provider+language
  tts: Map<string, TTSProvider>;       // key = provider+voice
  format: Map<string, FormatProvider>; // key = provider+model
}

const cache: ProcessorCache = {
  stt: new Map(),
  tts: new Map(),
  format: new Map(),
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

function getFormatter(config: ServiceConfig): FormatProvider | null {
  if (!config.format) return null;
  const key = `${config.format.provider}:${config.format.model || 'default'}`;
  if (!cache.format.has(key)) {
    cache.format.set(key, createFormatProvider(config.format));
  }
  return cache.format.get(key)!;
}

export interface InboundResult {
  /** Whether AI formatting was applied to the message text */
  formatApplied?: boolean;
  /** Original message text before formatting (only set when formatting changed it) */
  formatOriginalText?: string;
  /** If formatting failed, the error message — signals the request should be cancelled */
  formatError?: string;
  /** If STT transcription failed, the error message — recorded for visibility in logs */
  sttError?: string;
  /** Whether translation produced a result */
  translateApplied?: boolean;
  /** If translation failed, the error message — recorded for visibility in logs */
  translateError?: string;
}

/**
 * Process inbound message:
 * 1. If audio + STT configured → transcribe to text
 * 2. If format configured → run AI formatting on text
 * Mutates the message in place. Returns format processing info.
 */
export async function processInbound(message: UnifiedMessage, serviceConfig: ServiceConfig): Promise<InboundResult> {
  const result: InboundResult = {};

  // Step 1: STT — transcribe audio to text
  if (message.type === 'audio' && serviceConfig.stt && message.media?.buffer) {
    const stt = getSTT(serviceConfig);
    if (stt) {
      try {
        const mimetype = message.media.mimetype || 'audio/ogg';
        const langHint = serviceConfig.stt.language || '(auto-detect)';
        console.log(`[stt] Transcribing message ${message.id} (${mimetype}, ${message.media.buffer.length} bytes, lang=${langHint})...`);
        const sttResult = await stt.transcribe(message.media.buffer, mimetype, serviceConfig.stt.language);
        const transcript = sttResult.text;
        if (transcript) {
          message.text = transcript;
          if (sttResult.detectedLanguage) {
            message.detectedLanguage = sttResult.detectedLanguage;
          }
          const detected = sttResult.detectedLanguage ? ` (detected=${sttResult.detectedLanguage})` : '';
          console.log(`[stt] Transcribed${detected}: "${transcript.substring(0, 80)}${transcript.length > 80 ? '...' : ''}"`);
        } else {
          console.log(`[stt] Empty transcription for message ${message.id}`);
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[stt] Transcription failed for message ${message.id}:`, errMsg);
        result.sttError = errMsg.substring(0, 300);
      } finally {
        // Honor forward_audio: false even on STT failure — don't leak raw audio to webhook
        if (!serviceConfig.stt.forward_audio) {
          delete message.media;
        }
      }
    }
  }

  // Step 2: AI formatting — transform text using configured prompt
  if (serviceConfig.format && message.text) {
    const formatter = getFormatter(serviceConfig);
    if (formatter) {
      try {
        console.log(`[format] Formatting message ${message.id} with ${serviceConfig.format.provider}...`);
        const originalText = message.text;
        const formatted = await formatter.format(message.text, serviceConfig.format.prompt);
        if (formatted) {
          console.log(`[format] Result: "${formatted.substring(0, 80)}${formatted.length > 80 ? '...' : ''}"`);
          message.text = formatted;
          result.formatApplied = true;
          result.formatOriginalText = originalText;
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[format] Formatting failed for message ${message.id}:`, errMsg);
        result.formatError = errMsg.substring(0, 300);
      }
    }
  }

  // Step 3: Translation — produces `translatedText` alongside the (possibly STT/format-processed) `text`.
  // Target language is configured per service; source language is whatever STT detected (or unknown).
  if (serviceConfig.translate && message.text) {
    const target = serviceConfig.translate.target_language;
    try {
      console.log(`[translate] Translating message ${message.id} to ${target}${message.detectedLanguage ? ` (source=${message.detectedLanguage})` : ''}...`);
      const translated = await runTranslate(message.text, serviceConfig.translate, message.detectedLanguage);
      if (translated) {
        message.translatedText = translated;
        message.translatedLanguage = target;
        result.translateApplied = true;
        console.log(`[translate] Result: "${translated.substring(0, 80)}${translated.length > 80 ? '...' : ''}"`);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[translate] Translation failed for message ${message.id}:`, errMsg);
      result.translateError = errMsg.substring(0, 300);
    }
  }

  return result;
}

export interface OutboundResult {
  response: WebhookResponse;
  ttsError?: string;
}

/** Strip messaging formatting characters so TTS reads clean text. */
function stripFormatting(text: string): string {
  return text
    .replace(/\*([^*]+)\*/g, '$1')       // *bold*
    .replace(/_([^_]+)_/g, '$1')         // _italic_
    .replace(/~([^~]+)~/g, '$1')         // ~strikethrough~
    .replace(/```[\s\S]*?```/g, '')      // ```code blocks```
    .replace(/`([^`]+)`/g, '$1')         // `inline code`
    .replace(/^>\s?/gm, '')              // > blockquote
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link text](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // ![alt](image url)
    .replace(/^#{1,6}\s+/gm, '')         // # headings
    .replace(/^[-*+]\s+/gm, '')          // bullet lists
    .replace(/^\d+\.\s+/gm, '')          // numbered lists
    .trim();
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
    const ttsText = stripFormatting(response.text);
    console.log(`[tts] Synthesizing: "${ttsText.substring(0, 80)}${ttsText.length > 80 ? '...' : ''}"`);
    const { buffer, mimetype } = await tts.synthesize(ttsText, serviceConfig.tts.voice);
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
