import express, { Express, Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { ServerContext } from '../types';
import { loadConfig } from '../../config/parser';

/**
 * Verify Twilio request signature.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  // Build the data string: URL + sorted params concatenated
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) {
    data += key + params[key];
  }
  const computed = createHmac('sha1', authToken).update(data).digest('base64');
  if (computed.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

/**
 * Verify Resend (Svix) webhook signature.
 * See: https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
function verifyResendSignature(secret: string, msgId: string, timestamp: string, body: string, signatures: string): boolean {
  // secret is base64-encoded after removing the "whsec_" prefix
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const toSign = `${msgId}.${timestamp}.${body}`;
  const computed = createHmac('sha256', secretBytes).update(toSign).digest('base64');
  // signatures can contain multiple space-separated values (v1,xxx)
  const sigs = signatures.split(' ').map(s => s.replace(/^v\d+,/, ''));
  return sigs.some(sig => {
    if (sig.length !== computed.length) return false;
    return timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
  });
}

/** Build the full request URL for Twilio signature verification. */
function getFullUrl(req: Request, ctx: ServerContext): string {
  const base = ctx.publicUrl || `${req.protocol}://${req.headers.host}`;
  return `${base}${req.originalUrl}`;
}

/** Look up a Twilio channel's auth_token from config. */
function getTwilioAuthToken(ctx: ServerContext, channelName: string): string | null {
  if (!ctx.configPath) return null;
  try {
    const config = loadConfig(ctx.configPath, { validate: false });
    const ch = config.channels[channelName];
    if (!ch) return null;
    return (ch as any).auth_token || process.env.TWILIO_AUTH_TOKEN || null;
  } catch {
    return null;
  }
}

/** Look up a Resend channel's webhook_secret from config. */
function getResendWebhookSecret(ctx: ServerContext, channelName: string): string | null {
  if (!ctx.configPath) return null;
  try {
    const config = loadConfig(ctx.configPath, { validate: false });
    const ch = config.channels[channelName];
    if (!ch) return null;
    return (ch as any).webhook_secret || null;
  } catch {
    return null;
  }
}

export function registerInboundRoutes(app: Express, ctx: ServerContext): void {
  // POST /inbound/voice/:channel — Twilio Voice incoming call
  app.post('/inbound/voice/:channel', express.urlencoded({ extended: false }), (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleIncomingCall) {
      res.type('text/xml').send('<Response><Say>Service unavailable.</Say><Hangup/></Response>');
      return;
    }

    // Verify Twilio signature
    const authToken = getTwilioAuthToken(ctx, channelName);
    const sig = req.headers['x-twilio-signature'] as string;
    if (authToken && sig) {
      const url = getFullUrl(req, ctx);
      if (!verifyTwilioSignature(authToken, url, req.body, sig)) {
        console.warn(`[voice-inbound] Invalid Twilio signature for ${channelName}`);
        res.status(403).type('text/xml').send('<Response><Say>Forbidden.</Say><Hangup/></Response>');
        return;
      }
    }

    try {
      const voiceConfig = ctx.findVoiceConfig?.(channelName);
      const twiml = (channel as any).handleIncomingCall(req.body, voiceConfig);
      res.type('text/xml').send(twiml);
    } catch (err: any) {
      console.error(`[voice-inbound] Error:`, err);
      res.type('text/xml').send('<Response><Say>An error occurred.</Say><Hangup/></Response>');
    }
  });

  // POST /inbound/voice/:channel/recording — Twilio Voice recording callback
  app.post('/inbound/voice/:channel/recording', express.urlencoded({ extended: false }), async (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleRecording) {
      res.type('text/xml').send('<Response><Hangup/></Response>');
      return;
    }

    const authToken = getTwilioAuthToken(ctx, channelName);
    const sig = req.headers['x-twilio-signature'] as string;
    if (authToken && sig) {
      const url = getFullUrl(req, ctx);
      if (!verifyTwilioSignature(authToken, url, req.body, sig)) {
        console.warn(`[voice-recording] Invalid Twilio signature for ${channelName}`);
        res.status(403).type('text/xml').send('<Response><Hangup/></Response>');
        return;
      }
    }

    try {
      const voiceConfig = ctx.findVoiceConfig?.(channelName);
      const twiml = await (channel as any).handleRecording(req.body, voiceConfig);
      res.type('text/xml').send(twiml);
    } catch (err: any) {
      console.error(`[voice-recording] Error:`, err);
      res.type('text/xml').send('<Response><Say>An error occurred.</Say><Hangup/></Response>');
    }
  });

  // POST /inbound/voice/:channel/respond/:callSid — Twilio Voice response redirect
  app.post('/inbound/voice/:channel/respond/:callSid', express.urlencoded({ extended: false }), (req, res) => {
    const { channel: channelName, callSid } = req.params;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleRespond) {
      res.type('text/xml').send('<Response><Hangup/></Response>');
      return;
    }

    const authToken = getTwilioAuthToken(ctx, channelName);
    const sig = req.headers['x-twilio-signature'] as string;
    if (authToken && sig) {
      const url = getFullUrl(req, ctx);
      if (!verifyTwilioSignature(authToken, url, req.body, sig)) {
        console.warn(`[voice-respond] Invalid Twilio signature for ${channelName}`);
        res.status(403).type('text/xml').send('<Response><Hangup/></Response>');
        return;
      }
    }

    try {
      const voiceConfig = ctx.findVoiceConfig?.(channelName);
      const twiml = (channel as any).handleRespond(callSid, voiceConfig);
      res.type('text/xml').send(twiml);
    } catch (err: any) {
      console.error(`[voice-respond] Error:`, err);
      res.type('text/xml').send('<Response><Hangup/></Response>');
    }
  });

  // GET /inbound/voice/:channel/audio/:id — serve cached TTS audio
  app.get('/inbound/voice/:channel/audio/:id', (req, res) => {
    const { channel: channelName, id } = req.params;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).getAudio) {
      res.status(404).send('Not found');
      return;
    }
    const entry = (channel as any).getAudio(id);
    if (!entry) {
      res.status(404).send('Audio not found or expired');
      return;
    }
    res.set('Content-Type', entry.mimetype);
    res.set('Content-Length', String(entry.buffer.length));
    res.send(entry.buffer);
  });

  // POST /inbound/twilio/:channel — Twilio SMS inbound webhook
  app.post('/inbound/twilio/:channel', express.urlencoded({ extended: false }), (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleInbound) {
      res.status(404).send('<Response></Response>');
      return;
    }

    // Verify Twilio signature
    const authToken = getTwilioAuthToken(ctx, channelName);
    const sig = req.headers['x-twilio-signature'] as string;
    if (authToken && sig) {
      const url = getFullUrl(req, ctx);
      if (!verifyTwilioSignature(authToken, url, req.body, sig)) {
        console.warn(`[twilio-inbound] Invalid Twilio signature for ${channelName}`);
        res.status(403).type('text/xml').send('<Response></Response>');
        return;
      }
    }

    try {
      (channel as any).handleInbound(req.body);
      res.type('text/xml').send('<Response></Response>');
    } catch (err: any) {
      console.error(`[twilio-inbound] Error:`, err);
      res.type('text/xml').send('<Response></Response>');
    }
  });

  // ALL /inbound/endpoint/:channel — Endpoint channel inbound
  app.all('/inbound/endpoint/:channel', async (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleRequest) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const endpointChannel = channel as any;
    const cfg = endpointChannel.cfg;

    // Validate HTTP method
    const allowedMethod = (cfg.method || 'POST').toUpperCase();
    if (req.method !== allowedMethod) {
      res.status(405).json({ error: `Method not allowed` });
      return;
    }

    // Validate secret (timing-safe)
    if (cfg.secret) {
      const provided = (req.headers['x-channel-secret'] || '') as string;
      if (!provided || provided.length !== cfg.secret.length ||
          !timingSafeEqual(Buffer.from(provided), Buffer.from(cfg.secret))) {
        res.status(401).json({ error: 'Invalid or missing X-Channel-Secret header' });
        return;
      }
    }

    try {
      const query = req.query as Record<string, string>;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
      }

      const { message, waitForResponse } = endpointChannel.handleRequest(
        req.body,
        query,
        headers,
        req.method,
      );

      if (waitForResponse) {
        const response = await waitForResponse;
        if (response._error) {
          const { _error, ...body } = response;
          res.status(502).json({ error: body.text });
        } else {
          res.json(response);
        }
      } else {
        res.json({ ok: true, id: message.id });
      }
    } catch (err: any) {
      console.error(`[endpoint-inbound] Error:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /inbound/resend/:channel — Resend inbound email webhook
  app.post('/inbound/resend/:channel', express.text({ type: '*/*', limit: '1mb' }), (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleInbound) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Verify Resend (Svix) webhook signature
    const webhookSecret = getResendWebhookSecret(ctx, channelName);
    const svixId = req.headers['svix-id'] as string;
    const svixTimestamp = req.headers['svix-timestamp'] as string;
    const svixSignature = req.headers['svix-signature'] as string;
    if (webhookSecret && svixId && svixTimestamp && svixSignature) {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!verifyResendSignature(webhookSecret, svixId, svixTimestamp, rawBody, svixSignature)) {
        console.warn(`[resend-inbound] Invalid webhook signature for ${channelName}`);
        res.status(403).json({ error: 'Invalid signature' });
        return;
      }
    }

    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      (channel as any).handleInbound(payload);
      res.json({ ok: true });
    } catch (err: any) {
      console.error(`[resend-inbound] Error:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
