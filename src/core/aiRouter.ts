import { ChannelConfig, ServiceConfig, SettingsConfig } from '../config/types';

interface ServiceInfo {
  name: string;
  webhook: string;
  description?: string;
}

interface AIRouterResult {
  serviceName: string | null;
  error?: string;
}

/**
 * Use an AI provider to classify which service a message should be routed to.
 */
export async function aiRoute(
  message: string,
  services: ServiceInfo[],
  channelConfig: ChannelConfig,
  settings: SettingsConfig,
): Promise<AIRouterResult> {
  const aiConfig = channelConfig.ai_routing;
  if (!aiConfig) return { serviceName: null, error: 'No ai_routing config' };

  const provider = aiConfig.provider;
  const serviceList = services.map(s => {
    const desc = s.description ? ` — ${s.description}` : '';
    return `- ${s.name}${desc}`;
  }).join('\n');

  const systemPrompt = `You are a message router. Given a user message, determine which service it should be sent to.

Available services:
${serviceList}

Respond with ONLY the service name (exactly as listed above) that best matches the user's message.
If no service is a good match, respond with "NONE".
Do not include any explanation or extra text.`;

  try {
    if (provider === 'openai') {
      return await callOpenAI(systemPrompt, message, aiConfig.model || 'gpt-4o-mini', settings.openai_api_key || process.env.OPENAI_API_KEY || '');
    } else if (provider === 'anthropic') {
      return await callAnthropic(systemPrompt, message, aiConfig.model || 'claude-haiku-4-5-20251001', settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '');
    } else if (provider === 'google') {
      return await callGoogle(systemPrompt, message, aiConfig.model || 'gemini-2.0-flash', settings.google_api_key || process.env.GOOGLE_API_KEY || '');
    }
    return { serviceName: null, error: `Unknown AI provider: ${provider}` };
  } catch (err: any) {
    return { serviceName: null, error: err.message };
  }
}

async function callOpenAI(systemPrompt: string, userMessage: string, model: string, apiKey: string): Promise<AIRouterResult> {
  if (!apiKey) return { serviceName: null, error: 'OpenAI API key not configured' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 50,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  const reply = data.choices?.[0]?.message?.content?.trim() || '';
  return { serviceName: reply === 'NONE' ? null : reply };
}

async function callAnthropic(systemPrompt: string, userMessage: string, model: string, apiKey: string): Promise<AIRouterResult> {
  if (!apiKey) return { serviceName: null, error: 'Anthropic API key not configured' };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 50,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  const reply = data.content?.[0]?.text?.trim() || '';
  return { serviceName: reply === 'NONE' ? null : reply };
}

async function callGoogle(systemPrompt: string, userMessage: string, model: string, apiKey: string): Promise<AIRouterResult> {
  if (!apiKey) return { serviceName: null, error: 'Google API key not configured' };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 50, temperature: 0 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google AI API error ${res.status}: ${text}`);
  }

  const data = await res.json() as any;
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return { serviceName: reply === 'NONE' ? null : reply };
}
