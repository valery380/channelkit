/**
 * Translation: LLM-backed text translation to a target language.
 *
 * Reuses the FormatProvider plumbing (OpenAI / Anthropic / Google), and builds
 * a translation prompt on the fly. When no provider is explicitly configured,
 * picks the first one with an available API key.
 */

import { FormatServiceConfig, TranslateServiceConfig } from '../config/types';
import { createFormatProvider, FormatProvider } from './formatter';

type ProviderName = 'openai' | 'anthropic' | 'google';

/** Map of common ISO 639-1 codes to human language names — used to build clearer prompts. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  he: 'Hebrew',
  el: 'Greek',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  tr: 'Turkish',
  pl: 'Polish',
  nl: 'Dutch',
  sv: 'Swedish',
  uk: 'Ukrainian',
  ro: 'Romanian',
  cs: 'Czech',
  fi: 'Finnish',
  da: 'Danish',
  no: 'Norwegian',
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] || code;
}

function pickAvailableProvider(): ProviderName | null {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GOOGLE_API_KEY) return 'google';
  return null;
}

function buildPrompt(targetCode: string, sourceCode?: string): string {
  const target = languageName(targetCode);
  const sourcePart = sourceCode ? ` from ${languageName(sourceCode)}` : '';
  return [
    `You are a translator. Translate the following text${sourcePart} to ${target}.`,
    `Return only the translation — no explanations, no quotes, no commentary.`,
    `Preserve line breaks, lists, emoji, and any inline links exactly as in the source.`,
  ].join(' ');
}

const cache = new Map<string, FormatProvider>();
function getProvider(provider: ProviderName, model?: string): FormatProvider {
  const key = `${provider}:${model || 'default'}`;
  if (!cache.has(key)) {
    // FormatServiceConfig requires `prompt` but the providers ignore it — only
    // the format(text, prompt) call uses the prompt. Cast to satisfy the type.
    const cfg = { provider, model, prompt: '' } as FormatServiceConfig;
    cache.set(key, createFormatProvider(cfg));
  }
  return cache.get(key)!;
}

export async function translate(
  text: string,
  config: TranslateServiceConfig,
  sourceLanguage?: string,
): Promise<string> {
  if (!text.trim()) return '';

  const provider = config.provider || pickAvailableProvider();
  if (!provider) {
    throw new Error(
      'No translation provider available — set openai_api_key, anthropic_api_key, or google_api_key in settings.',
    );
  }

  // Skip the LLM round-trip if the source equals the target.
  if (sourceLanguage && sourceLanguage.toLowerCase() === config.target_language.toLowerCase()) {
    return text;
  }

  const fmt = getProvider(provider, config.model);
  const prompt = buildPrompt(config.target_language, sourceLanguage);
  const result = await fmt.format(text, prompt);
  return (result || '').trim();
}
