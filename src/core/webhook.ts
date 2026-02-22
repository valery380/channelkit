import { UnifiedMessage, WebhookResponse } from './types';

function backoffDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
}

export async function dispatchWebhook(
  url: string,
  message: UnifiedMessage,
  replyUrl?: string,
  { maxRetries = 3, timeout = 5000 }: { maxRetries?: number; timeout?: number } = {}
): Promise<WebhookResponse | null> {
  const payload = replyUrl ? { ...message, replyUrl } : message;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        // 4xx = permanent failure, don't retry
        if (res.status >= 400 && res.status < 500) {
          console.error(`[webhook] ${url} responded ${res.status} (permanent)`);
          return null;
        }
        // 5xx = transient, retry
        if (attempt < maxRetries) {
          console.warn(`[webhook] ${url} responded ${res.status}, retrying (${attempt + 1}/${maxRetries})...`);
          await backoffDelay(attempt);
          continue;
        }
        console.error(`[webhook] ${url} responded ${res.status} after ${maxRetries} retries`);
        return null;
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as WebhookResponse;
      }

      return null;
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err?.name === 'AbortError';
      const label = isAbort ? 'timed out' : String(err?.message || err);

      if (attempt < maxRetries) {
        console.warn(`[webhook] ${url} ${label}, retrying (${attempt + 1}/${maxRetries})...`);
        await backoffDelay(attempt);
      } else {
        console.error(`[webhook] Failed to dispatch to ${url} after ${maxRetries} retries: ${label}`);
      }
    }
  }

  return null;
}
