/**
 * Speech-to-Text providers for ChannelKit
 */

export interface STTProvider {
  transcribe(audio: Buffer, mimetype: string, language?: string): Promise<string>;
}

export interface STTConfig {
  provider: 'google' | 'whisper' | 'deepgram';
  language?: string;            // e.g. 'he-IL', 'en-US' — primary language
  alternative_languages?: string[];  // e.g. ['en-US', 'ar-IL'] — auto-detect from these + primary
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
 * Google Cloud Speech-to-Text (REST API)
 * Supports both API key and Application Default Credentials (ADC).
 * Priority: GOOGLE_STT_API_KEY > GOOGLE_API_KEY > ADC (gcloud auth)
 */
class GoogleSTT implements STTProvider {
  private apiKey: string | null;

  constructor(private sttConfig: STTConfig) {
    // API key is optional — fall back to ADC
    this.apiKey = process.env.GOOGLE_STT_API_KEY
      || process.env.GOOGLE_API_KEY
      || null;
  }

  /**
   * Get an access token from ADC (Application Default Credentials).
   * Works when `gcloud auth application-default login` has been run,
   * or when GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON.
   */
  private async getAccessToken(): Promise<string> {
    const fs = await import('fs');
    const home = process.env.HOME || '~';
    const candidates = [
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      `${home}/.config/google/stt-credentials.json`,
      `${home}/.config/gcloud/application_default_credentials.json`,
    ].filter(Boolean) as string[];
    
    const credPath = candidates.find(p => fs.existsSync(p));
    
    if (!credPath) {
      throw new Error(
        `Google STT: No API key and no ADC found. Either set GOOGLE_STT_API_KEY / GOOGLE_API_KEY, ` +
        `or run "gcloud auth application-default login".`
      );
    }

    const fsSync = await import('fs');
    const creds = JSON.parse(fsSync.readFileSync(credPath, 'utf-8'));

    // Service account JSON
    if (creds.type === 'service_account') {
      const jwt = await this.createServiceAccountJWT(creds);
      return jwt;
    }

    // User credentials (from gcloud auth)
    if (creds.type === 'authorized_user') {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          refresh_token: creds.refresh_token,
          grant_type: 'refresh_token',
        }),
      });
      if (!res.ok) throw new Error(`Failed to refresh Google token: ${res.status}`);
      const data = await res.json() as any;
      return data.access_token;
    }

    throw new Error(`Unsupported Google credential type: ${creds.type}`);
  }

  private async createServiceAccountJWT(creds: any): Promise<string> {
    const crypto = await import('crypto');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), creds.private_key);
    const jwt = `${header}.${payload}.${signature.toString('base64url')}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    if (!res.ok) throw new Error(`Failed to get service account token: ${res.status}`);
    const data = await res.json() as any;
    return data.access_token;
  }

  async transcribe(audio: Buffer, mimetype: string, language?: string): Promise<string> {
    const encoding = this.getEncoding(mimetype);
    const langCode = language || this.sttConfig.language || 'en-US';
    const config: any = {
      encoding,
      languageCode: langCode,
      enableAutomaticPunctuation: true,
    };

    // WhatsApp Ogg/Opus files have sample rate 0 in the header, so always specify explicitly.
    // WhatsApp voice notes are 16kHz; generic Opus is typically 48kHz.
    config.sampleRateHertz = encoding === 'OGG_OPUS' ? 16000 : 16000;

    // Auto language detection: add alternative languages
    if (this.sttConfig.alternative_languages?.length) {
      config.alternativeLanguageCodes = this.sttConfig.alternative_languages;
    }

    // Validate audio header
    const magic = audio.slice(0, 4).toString('ascii');
    if (encoding === 'OGG_OPUS' && magic !== 'OggS') {
      console.warn(`[stt:google] Audio buffer does not start with OggS magic (got: ${magic}). Buffer may be corrupt.`);
    }

    const body = {
      config,
      audio: {
        content: audio.toString('base64'),
      },
    };

    // Use API key if available, otherwise ADC
    let url: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.apiKey) {
      url = `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`;
    } else {
      const token = await this.getAccessToken();
      url = 'https://speech.googleapis.com/v1/speech:recognize';
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`[stt:google] Request config: encoding=${encoding}, lang=${langCode}, audioBytes=${audio.length}, magic=${magic}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google STT error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    const results = data.results || [];
    if (!results.length) {
      console.log(`[stt:google] No results returned. Response: ${JSON.stringify(data).slice(0, 500)}`);
    }
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
    if (language) {
      params.set('language', language.split('-')[0]);
    } else {
      params.set('detect_language', 'true');
    }

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
      return new GoogleSTT(config);
    case 'whisper':
      return new WhisperSTT();
    case 'deepgram':
      return new DeepgramSTT();
    default:
      throw new Error(`Unknown STT provider: ${config.provider}`);
  }
}
