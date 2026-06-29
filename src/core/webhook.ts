import { UnifiedMessage, WebhookResponse } from './types';
import { ServiceAuthConfig } from '../config/types';

let localWebhooksAllowed = false;

/** Call at startup to allow webhooks to localhost / private IPs. */
export function setAllowLocalWebhooks(value: boolean): void {
  localWebhooksAllowed = value;
}

/** Block requests to private/reserved IP ranges and cloud metadata endpoints. */
function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    // Always block cloud metadata endpoints
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
    // Allow localhost and private IPs when configured
    if (localWebhooksAllowed) return false;
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

export interface WebhookError {
  type: 'blocked' | 'http' | 'timeout' | 'network';
  status?: number;
  message: string;
  body?: string;
}

export interface WebhookTranscript {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
  };
}

export interface WebhookResult {
  response: WebhookResponse | null;
  error?: WebhookError;
  transcript?: WebhookTranscript;
}

const REDACT_HEADER_NAMES = new Set([
  'authorization', 'cookie', 'set-cookie', 'proxy-authorization',
  'x-api-key', 'x-auth-token',
]);
const BODY_PREVIEW_LIMIT = 8 * 1024;

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADER_NAMES.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
}

function truncatePreview(s: string, n: number = BODY_PREVIEW_LIMIT): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n... [truncated, ${s.length - n} more chars]`;
}

/** Read up to 1 KB of response body text for error diagnostics. */
async function readErrorBody(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text ? text.slice(0, 1024) : undefined;
  } catch {
    return undefined;
  }
}

export async function dispatchWebhook(
  url: string,
  message: UnifiedMessage,
  replyUrl?: string,
  { maxRetries = 3, timeout = 5000, method = 'POST', auth }: { maxRetries?: number; timeout?: number; method?: string; auth?: ServiceAuthConfig } = {}
): Promise<WebhookResult> {
  const httpMethod = (method || 'POST').toUpperCase();

  if (isBlockedUrl(url)) {
    const msg = `Blocked request to private/reserved address: ${url}`;
    console.error(`[webhook] ${msg}`);
    return {
      response: null,
      error: { type: 'blocked', message: msg },
      transcript: { request: { url, method: httpMethod, headers: {} } },
    };
  }

  const payload = replyUrl ? { ...message, replyUrl } : message;
  const authHeaders = buildAuthHeaders(auth);

  // Send as multipart/form-data when method is POST and message carries a media buffer
  const useMultipart = httpMethod === 'POST' && !!message.media?.buffer;

  let body: FormData | string | undefined;
  let headers: Record<string, string>;
  let requestBodyPreview: string | undefined;

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
    requestBodyPreview = truncatePreview(JSON.stringify({
      metadata,
      file: { filename, mimetype, size: message.media!.buffer!.length },
    }, null, 2));
  } else {
    const canHaveBody = httpMethod !== 'GET' && httpMethod !== 'HEAD';
    body = canHaveBody ? JSON.stringify(payload) : undefined;
    headers = { 'Content-Type': 'application/json', ...authHeaders };
    if (body) {
      try {
        requestBodyPreview = truncatePreview(JSON.stringify(JSON.parse(body), null, 2));
      } catch {
        requestBodyPreview = truncatePreview(body);
      }
    }
  }

  const transcript: WebhookTranscript = {
    request: {
      url,
      method: httpMethod,
      headers: redactHeaders(headers),
      body: requestBodyPreview,
    },
  };

  let lastError: WebhookError | undefined;

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

      const resHeaders = redactHeaders(headersToObject(res.headers));
      const contentType = res.headers.get('content-type') || '';
      const isBinary = !!contentType && !contentType.includes('application/json') && !contentType.includes('text/');

      // Read the body once. Use arrayBuffer for binary so we can still return it as media.
      let arrayBuf: ArrayBuffer | undefined;
      let bodyText: string | undefined;
      if (isBinary) {
        arrayBuf = await res.arrayBuffer();
      } else {
        try { bodyText = await res.text(); } catch { bodyText = ''; }
      }

      const responseBodyPreview = isBinary
        ? `[binary: ${contentType.split(';')[0].trim() || 'application/octet-stream'}, ${arrayBuf?.byteLength ?? 0} bytes]`
        : (bodyText ? (contentType.includes('application/json')
            ? (() => { try { return truncatePreview(JSON.stringify(JSON.parse(bodyText!), null, 2)); } catch { return truncatePreview(bodyText!); } })()
            : truncatePreview(bodyText)) : '');

      transcript.response = {
        status: res.status,
        statusText: res.statusText || `HTTP ${res.status}`,
        headers: resHeaders,
        body: responseBodyPreview,
      };

      if (!res.ok) {
        const errorBody = bodyText ? bodyText.slice(0, 1024) : undefined;
        const statusText = res.statusText || `HTTP ${res.status}`;
        lastError = {
          type: 'http',
          status: res.status,
          message: `${statusText}${errorBody ? `: ${errorBody}` : ''}`,
          body: errorBody,
        };

        // 4xx = permanent failure, don't retry
        if (res.status >= 400 && res.status < 500) {
          console.error(`[webhook] ${url} responded ${res.status} (permanent)${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
          return { response: null, error: lastError, transcript };
        }
        // 5xx = transient, retry
        if (attempt < maxRetries) {
          console.warn(`[webhook] ${url} responded ${res.status}, retrying (${attempt + 1}/${maxRetries})...`);
          await backoffDelay(attempt);
          continue;
        }
        console.error(`[webhook] ${url} responded ${res.status} after ${maxRetries} retries${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`);
        return { response: null, error: lastError, transcript };
      }

      if (contentType.includes('application/json') && bodyText) {
        try {
          return { response: JSON.parse(bodyText) as WebhookResponse, transcript };
        } catch {
          return { response: { text: bodyText } as WebhookResponse, transcript };
        }
      }

      if (isBinary && arrayBuf && arrayBuf.byteLength > 0) {
        const mimetype = contentType.split(';')[0].trim();
        return {
          response: {
            media: { buffer: Buffer.from(arrayBuf), mimetype },
          } as WebhookResponse,
          transcript,
        };
      }

      if (contentType.includes('text/') && bodyText) {
        return { response: { text: bodyText } as WebhookResponse, transcript };
      }

      return { response: null, transcript };
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err?.name === 'AbortError';
      const label = isAbort ? 'timed out' : String(err?.message || err);
      lastError = {
        type: isAbort ? 'timeout' : 'network',
        message: label,
      };
      transcript.response = undefined;

      if (attempt < maxRetries) {
        console.warn(`[webhook] ${url} ${label}, retrying (${attempt + 1}/${maxRetries})...`);
        await backoffDelay(attempt);
      } else {
        console.error(`[webhook] Failed to dispatch to ${url} after ${maxRetries} retries: ${label}`);
      }
    }
  }

  return { response: null, error: lastError, transcript };
}
