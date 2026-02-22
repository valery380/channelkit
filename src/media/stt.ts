/**
 * Speech-to-Text providers for ChannelKit
 */

export interface STTProvider {
  transcribe(audio: Buffer, mimetype: string, language?: string): Promise<string>;
}

export interface STTConfig {
  provider: 'google' | 'whisper' | 'deepgram';
  language?: string;  // e.g. 'he-IL', 'en-US'
}

// Env var convention: <PROVIDER>_STT_API_KEY
function getApiKey(provider: string): string {
  const key = process.env[`${provider.toUpperCase()}_STT_API_KEY`]
    || process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!key) {
    throw new Error(`Missing API key for STT provider "${provider}". Set ${provider.toUpperCase()}_STT_API_KEY or ${provider.toUpperCase()}_API_KEY environment variable.`);
  }
  return key;
}

/**
 * Google Cloud Speech-to-Text (REST API, no SDK needed)
 */
class GoogleSTT implements STTProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey('google');
  }

  async transcribe(audio: Buffer, mimetype: string, language?: string): Promise<string> {
    const encoding = this.getEncoding(mimetype);
    const body = {
      config: {
        encoding,
        sampleRateHertz: encoding === 'OGG_OPUS' ? 48000 : 16000,
        languageCode: language || 'en-US',
        model: 'default',
        enableAutomaticPunctuation: true,
      },
      audio: {
        content: audio.toString('base64'),
      },
    };

    const res = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google STT error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    const results = data.results || [];
    return results
      .map((r: any) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();
  }

  private getEncoding(mimetype: string): string {
    if (mimetype.includes('opus') || mimetype.includes('ogg')) return 'OGG_OPUS';
    if (mimetype.includes('flac')) return 'FLAC';
    if (mimetype.includes('wav')) return 'LINEAR16';
    if (mimetype.includes('mp3') || mimetype.includes('mpeg')) return 'MP3';
    if (mimetype.includes('webm')) return 'WEBM_OPUS';
    return 'OGG_OPUS'; // default for voice messages
  }
}

/**
 * OpenAI Whisper API
 */
class WhisperSTT implements STTProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey('openai');
  }

  async transcribe(audio: Buffer, mimetype: string, language?: string): Promise<string> {
    const ext = this.getExtension(mimetype);
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)], { type: mimetype }), `audio.${ext}`);
    formData.append('model', 'whisper-1');
    if (language) {
      // Whisper expects ISO 639-1 (e.g. 'he', 'en'), not full locale
      formData.append('language', language.split('-')[0]);
    }

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Whisper STT error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    return (data.text || '').trim();
  }

  private getExtension(mimetype: string): string {
    if (mimetype.includes('ogg') || mimetype.includes('opus')) return 'ogg';
    if (mimetype.includes('mp3') || mimetype.includes('mpeg')) return 'mp3';
    if (mimetype.includes('wav')) return 'wav';
    if (mimetype.includes('webm')) return 'webm';
    if (mimetype.includes('flac')) return 'flac';
    return 'ogg';
  }
}

/**
 * Deepgram STT API
 */
class DeepgramSTT implements STTProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey('deepgram');
  }

  async transcribe(audio: Buffer, mimetype: string, language?: string): Promise<string> {
    const params = new URLSearchParams({
      model: 'nova-2',
      punctuate: 'true',
    });
    if (language) params.set('language', language.split('-')[0]);

    const res = await fetch(
      `https://api.deepgram.com/v1/listen?${params}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': mimetype,
        },
        body: audio,
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deepgram STT error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    return (data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
  }
}

/**
 * Create an STT provider instance
 */
export function createSTTProvider(config: STTConfig): STTProvider {
  switch (config.provider) {
    case 'google':
      return new GoogleSTT();
    case 'whisper':
      return new WhisperSTT();
    case 'deepgram':
      return new DeepgramSTT();
    default:
      throw new Error(`Unknown STT provider: ${config.provider}`);
  }
}
