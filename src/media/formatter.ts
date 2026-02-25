/**
 * AI Data Formatter: transforms message text using AI providers.
 *
 * Uses a user-defined prompt to instruct the AI how to format/transform
 * the incoming text (e.g. extract structured data, reformat, translate).
 */

import { FormatServiceConfig } from '../config/types';

export interface FormatProvider {
  format(text: string, prompt: string): Promise<string>;
}

function getApiKey(provider: string): string {
  const envMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
  };
  const envVar = envMap[provider];
  const key = envVar ? process.env[envVar] : undefined;
  if (!key) {
    throw new Error(`Missing API key for format provider "${provider}". Set ${envVar} in settings or environment.`);
  }
  return key;
}

class OpenAIFormatter implements FormatProvider {
  private apiKey: string;
  private model: string;

  constructor(config: FormatServiceConfig) {
    this.apiKey = getApiKey('openai');
    this.model = config.model || 'gpt-4o-mini';
  }

  async format(text: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: text },
          ],
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI ${res.status}: ${err.substring(0, 200)}`);
      }

      const data = await res.json() as any;
      return data.choices?.[0]?.message?.content?.trim() || text;
    } finally {
      clearTimeout(timer);
    }
  }
}

class AnthropicFormatter implements FormatProvider {
  private apiKey: string;
  private model: string;

  constructor(config: FormatServiceConfig) {
    this.apiKey = getApiKey('anthropic');
    this.model = config.model || 'claude-sonnet-4-20250514';
  }

  async format(text: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: prompt,
          messages: [
            { role: 'user', content: text },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic ${res.status}: ${err.substring(0, 200)}`);
      }

      const data = await res.json() as any;
      return data.content?.[0]?.text?.trim() || text;
    } finally {
      clearTimeout(timer);
    }
  }
}

class GoogleFormatter implements FormatProvider {
  private apiKey: string;
  private model: string;

  constructor(config: FormatServiceConfig) {
    this.apiKey = getApiKey('google');
    this.model = config.model || 'gemini-2.0-flash';
  }

  async format(text: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ parts: [{ text }] }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google ${res.status}: ${err.substring(0, 200)}`);
      }

      const data = await res.json() as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createFormatProvider(config: FormatServiceConfig): FormatProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIFormatter(config);
    case 'anthropic':
      return new AnthropicFormatter(config);
    case 'google':
      return new GoogleFormatter(config);
    default:
      throw new Error(`Unknown format provider: ${config.provider}`);
  }
}
