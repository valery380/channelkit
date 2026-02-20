import { UnifiedMessage, WebhookResponse } from './types';

export async function dispatchWebhook(
  url: string,
  message: UnifiedMessage,
  replyUrl?: string
): Promise<WebhookResponse | null> {
  try {
    const payload = replyUrl ? { ...message, replyUrl } : message;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[webhook] ${url} responded ${res.status}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as WebhookResponse;
    }

    return null;
  } catch (err) {
    console.error(`[webhook] Failed to dispatch to ${url}:`, err);
    return null;
  }
}
