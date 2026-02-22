/**
 * Text-to-Speech providers for ChannelKit
 */

export interface TTSProvider {
  synthesize(text: string, voice?: string): Promise<{ buffer: Buffer; mimetype: string }>;
}

export interface TTSConfig {
  provider: 'google' | 'elevenlabs' | 'openai';
  voice?: string;       // voice ID or name
  language?: string;    // e.g. 'he-IL' (for Google)
}

function getApiKey(provider: string): string {
  const key = process.env[`${provider.toUpperCase()}_TTS_API_KEY`]
    || process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!key) {
    throw new Error(`Missing API key for TTS provider "${provider}". Set ${provider.toUpperCase()}_TTS_API_KEY or ${provider.toUpperCase()}_API_KEY environment variable.`);
  }
  return key;
}

/**
 * Google Cloud Text-to-Speech (REST)
 */
class GoogleTTS implements TTSProvider {
  private apiKey: string;
  private language: string;

  constructor(config: TTSConfig) {
    this.apiKey = getApiKey('google');
    this.language = config.language || 'en-US';
  }

  async synthesize(text: string, voice?: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const body = {
      input: { text },
      voice: {
        languageCode: this.language,
        name: voice || undefined,
      },
      audioConfig: {
        audioEncoding: 'OGG_OPUS',
      },
    };

    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google TTS error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    const buffer = Buffer.from(data.audioContent, 'base64');
    return { buffer, mimetype: 'audio/ogg; codecs=opus' };
  }
}

/**
 * ElevenLabs TTS
 */
class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;
  private defaultVoice: string;

  constructor(config: TTSConfig) {
    this.apiKey = getApiKey('elevenlabs');
    this.defaultVoice = config.voice || '21m00Tcm4TlvDq8ikWAM'; // Rachel
  }

  async synthesize(text: string, voice?: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const voiceId = voice || this.defaultVoice;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_v3',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs TTS error: ${res.status} ${err}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    return { buffer, mimetype: 'audio/mpeg' };
  }
}

/**
 * OpenAI TTS
 */
class OpenAITTS implements TTSProvider {
  private apiKey: string;
  private defaultVoice: string;

  constructor(config: TTSConfig) {
    this.apiKey = getApiKey('openai');
    this.defaultVoice = config.voice || 'alloy';
  }

  async synthesize(text: string, voice?: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice || this.defaultVoice,
        response_format: 'opus',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS error: ${res.status} ${err}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    return { buffer, mimetype: 'audio/ogg; codecs=opus' };
  }
}

/**
 * Create a TTS provider instance
 */
export function createTTSProvider(config: TTSConfig): TTSProvider {
  switch (config.provider) {
    case 'google':
      return new GoogleTTS(config);
    case 'elevenlabs':
      return new ElevenLabsTTS(config);
    case 'openai':
      return new OpenAITTS(config);
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}
