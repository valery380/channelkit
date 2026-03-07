import { UnifiedMessage, WebhookResponse } from './types';
import { ServiceAuthConfig } from '../config/types';

/** Block requests to private/reserved IP ranges and cloud metadata endpoints. */
function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    // Block cloud metadata endpoints
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true;
    // Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 0) return true;
    }
    return false;
  } catch {
    return true; // Block malformed URLs
  }
}

function backoffDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
}

function buildAuthHeaders(auth?: ServiceAuthConfig): Record<string, string> {
  if (!auth) return {};
  if (auth.type === 'bearer' && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === 'header' && auth.header_name && auth.header_value) {
    return { [auth.header_name]: auth.header_value };
  }
  return {};
}

/** Generate a filename when the channel doesn't provide one */
function guessFilename(type: string, mimetype: string): string {
  const ext = mimetype.split('/').pop()?.split(';')[0] || 'bin';
  return `${type || 'file'}.${ext}`;
}

/** Normalize a phone-like identifier: strip WhatsApp JID suffix, ensure + prefix. */
function normalizePhone(value: string): string {
  // Strip WhatsApp JID suffixes (@s.whatsapp.net, @g.us, etc.)
  const stripped = value.replace(/@.+$/, '');
  // If it looks like a phone number (all digits, optionally with +), ensure + prefix
  if (/^\+?\d{7,15}$/.test(stripped)) {
    return stripped.startsWith('+') ? stripped : `+${stripped}`;
  }
  // Non-phone identifiers (emails, Telegram IDs) pass through unchanged
  return value;
}

const PLACEHOLDER_MAP: Record<string, (m: UnifiedMessage) => string | undefined> = {
  FROM: (m) => normalizePhone(m.from),
  CHANNEL: (m) => m.channel,
  CHANNEL_NAME: (m) => m.channelName,
  SENDER_NAME: (m) => m.senderName,
  MESSAGE_TYPE: (m) => m.type,
  GROUP_ID: (m) => m.groupId,
  GROUP_NAME: (m) => m.groupName,
  TEXT: (m) => m.text,
};

/**
 * Replace [PLACEHOLDER] tokens in a URL with values from the message.
 * Values are URI-encoded. Missing values become empty strings.
 */
export function resolvePlaceholders(url: string, message: UnifiedMessage): string {
  if (!url.includes('[')) return url;
  return url.replace(/\[([A-Z_]+)\]/g, (_match, key: string) => {
    const getter = PLACEHOLDER_MAP[key];
    const value = getter ? getter(message) : undefined;
    return encodeURIComponent(value || '');
  });
}

export async function dispatchWebhook(
  url: string,
  message: UnifiedMessage,
  replyUrl?: string,
  { maxRetries = 3, timeout = 5000, method = 'POST', auth }: { maxRetries?: number; timeout?: number; method?: string; auth?: ServiceAuthConfig } = {}
): Promise<WebhookResponse | null> {
  if (isBlockedUrl(url)) {
    console.error(`[webhook] Blocked request to private/reserved address: ${url}`);
    return null;
  }

  const payload = replyUrl ? { ...message, replyUrl } : message;
  const httpMethod = (method || 'POST').toUpperCase();
  const authHeaders = buildAuthHeaders(auth);

  // Send as multipart/form-data when method is POST and message carries a media buffer
  const useMultipart = httpMethod === 'POST' && !!message.media?.buffer;

  let body: FormData | string | undefined;
  let headers: Record<string, string>;

  if (useMultipart) {
    const formData = new FormData();

    // Build metadata: full payload without the buffer (not JSON-serializable)
    const { media, ...rest } = payload as any;
    const metadata = {
      ...rest,
      media: media ? { mimetype: media.mimetype, filename: media.filename } : undefined,
    };
    formData.append('metadata', JSON.stringify(metadata));

    // Append the file
    const mimetype = message.media!.mimetype || 'application/octet-stream';
    const filename = message.media!.filename || guessFilename(message.type, mimetype);
    const blob = new Blob([new Uint8Array(message.media!.buffer!)], { type: mimetype });
    formData.append('file', blob, filename);

    body = formData;
    // Don't set Content-Type — fetch sets it with the boundary automatically
    headers = { ...authHeaders };
  } else {
    const canHaveBody = httpMethod !== 'GET' && httpMethod !== 'HEAD';
    body = canHaveBody ? JSON.stringify(payload) : undefined;
    headers = { 'Content-Type': 'application/json', ...authHeaders };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: httpMethod,
        headers,
        ...(body && { body }),
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

      // Non-JSON response — return binary content (PDF, images, etc.) as media
      if (contentType && !contentType.includes('text/')) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          const mimetype = contentType.split(';')[0].trim();
          return {
            media: {
              buffer: Buffer.from(arrayBuf),
              mimetype,
            },
          } as WebhookResponse;
        }
      }

      // Text response (text/plain, text/csv, text/html, etc.) — return as text
      if (contentType && contentType.includes('text/')) {
        const text = await res.text();
        if (text) {
          return { text } as WebhookResponse;
        }
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
