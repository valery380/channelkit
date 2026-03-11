import { Express } from 'express';
import { ServerContext } from '../types';
import { loadConfig, saveConfig } from '../../config/parser';
import { WhatsAppChannel, isBaileysAvailable } from '../../channels/whatsapp';
import { DEFAULT_AUTH_DIR } from '../../paths';

/** Per-channel QR state for polling. */
const pairState = new Map<string, { qr: string | null; status: 'waiting' | 'paired' | 'error'; error?: string }>();

/** Keys in channel configs that contain secrets and should be masked in API responses. */
const SENSITIVE_CHANNEL_KEYS = ['api_key', 'bot_token', 'auth_token', 'client_secret', 'webhook_secret', 'secret'];

function maskValue(val: string): string {
  if (val.length <= 4) return '••••';
  return '•'.repeat(val.length - 4) + val.slice(-4);
}

function maskChannelSecrets(channels: Record<string, any>): Record<string, any> {
  const masked: Record<string, any> = {};
  for (const [name, ch] of Object.entries(channels)) {
    const copy = { ...ch };
    for (const key of SENSITIVE_CHANNEL_KEYS) {
      if (typeof copy[key] === 'string' && copy[key].length > 0) {
        copy[key] = maskValue(copy[key]);
      }
    }
    masked[name] = copy;
  }
  return masked;
}

/** Validate a channel/service name: only alphanumeric, hyphens, and underscores allowed. */
function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export function registerConfigRoutes(app: Express, ctx: ServerContext): void {
  // GET /api/config — return channels and services from config file (secrets masked)
  app.get('/api/config', (_req, res) => {
    if (!ctx.configPath) {
      res.status(503).json({ error: 'Config path not set' });
      return;
    }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      // Attach connection status from runtime channel instances
      const channels = maskChannelSecrets(config.channels);
      for (const [name, ch] of Object.entries(channels)) {
        const runtime = ctx.channels.get(name);
        (ch as any).connected = runtime ? runtime.connected : false;
        (ch as any).statusMessage = runtime ? (runtime as any).statusMessage || null : null;
      }
      res.json({ channels, services: config.services || {}, baileysAvailable: isBaileysAvailable() });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load config' });
    }
  });

  // POST /api/config/services — add a new service
  app.post('/api/config/services', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name, channel, webhook, code, command, allow_list, method, auth } = req.body;
    if (!name || !channel || !webhook) {
      res.status(400).json({ error: 'name, channel, and webhook are required' });
      return;
    }
    if (!isValidName(name)) {
      res.status(400).json({ error: 'Name must contain only letters, numbers, hyphens, and underscores' });
      return;
    }
    const validMethods = ['POST', 'GET', 'PUT', 'PATCH'];
    if (method && !validMethods.includes(method.toUpperCase())) {
      res.status(400).json({ error: `Invalid method. Must be one of: ${validMethods.join(', ')}` });
      return;
    }
    if (auth && !['bearer', 'header'].includes(auth.type)) {
      res.status(400).json({ error: 'Invalid auth type. Must be "bearer" or "header"' });
      return;
    }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.services) config.services = {};
      if (config.services[name]) {
        res.status(409).json({ error: `Service "${name}" already exists` });
        return;
      }
      if (!config.channels[channel]) {
        res.status(400).json({ error: `Channel "${channel}" does not exist` });
        return;
      }
      const methodUpper = method ? method.toUpperCase() : undefined;
      config.services[name] = {
        channel, webhook,
        ...(methodUpper && methodUpper !== 'POST' && { method: methodUpper }),
        ...(auth?.type && { auth }),
        ...(code && { code }),
        ...(command && { command }),
        ...(Array.isArray(allow_list) && allow_list.length > 0 && { allow_list }),
      };
      saveConfig(ctx.configPath, config);
      ctx.reloadRouter?.();
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/config/services/:name — update service fields
  app.put('/api/config/services/:name', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    const { webhook, code, command, stt, tts, voice, format, allow_list, method, auth } = req.body;
    if (!webhook) { res.status(400).json({ error: 'webhook is required' }); return; }
    const validMethods = ['POST', 'GET', 'PUT', 'PATCH'];
    if (method && !validMethods.includes(method.toUpperCase())) {
      res.status(400).json({ error: `Invalid method. Must be one of: ${validMethods.join(', ')}` });
      return;
    }
    if (auth && !['bearer', 'header'].includes(auth.type)) {
      res.status(400).json({ error: 'Invalid auth type. Must be "bearer" or "header"' });
      return;
    }
    const validSttProviders = ['google', 'whisper', 'deepgram'];
    const validTtsProviders = ['google', 'elevenlabs', 'openai'];
    const validFormatProviders = ['openai', 'anthropic', 'google'];
    if (stt && !validSttProviders.includes(stt.provider)) {
      res.status(400).json({ error: `Invalid STT provider. Must be one of: ${validSttProviders.join(', ')}` });
      return;
    }
    if (tts && !validTtsProviders.includes(tts.provider)) {
      res.status(400).json({ error: `Invalid TTS provider. Must be one of: ${validTtsProviders.join(', ')}` });
      return;
    }
    if (format && format.provider && !validFormatProviders.includes(format.provider)) {
      res.status(400).json({ error: `Invalid format provider. Must be one of: ${validFormatProviders.join(', ')}` });
      return;
    }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.services?.[name]) {
        res.status(404).json({ error: `Service "${name}" not found` });
        return;
      }
      config.services[name].webhook = webhook;
      const methodUpper = method ? method.toUpperCase() : undefined;
      if (methodUpper && methodUpper !== 'POST') { config.services[name].method = methodUpper as any; } else { delete config.services[name].method; }
      if (auth?.type) { config.services[name].auth = auth; } else { delete config.services[name].auth; }
      if (code) { config.services[name].code = code; } else { delete config.services[name].code; }
      if (command) { config.services[name].command = command; } else { delete config.services[name].command; }
      if ('stt' in req.body) {
        if (stt && stt.provider) {
          config.services[name].stt = { provider: stt.provider };
          if (stt.language) config.services[name].stt.language = stt.language;
          if (stt.alternative_languages?.length) config.services[name].stt.alternative_languages = stt.alternative_languages;
        } else {
          delete config.services[name].stt;
        }
      }
      if ('tts' in req.body) {
        if (tts && tts.provider) {
          config.services[name].tts = { provider: tts.provider };
          if (tts.language) config.services[name].tts.language = tts.language;
          if (tts.voice) config.services[name].tts.voice = tts.voice;
        } else {
          delete config.services[name].tts;
        }
      }
      if ('voice' in req.body) {
        if (voice && Object.keys(voice).some(k => voice[k])) {
          const v: any = {};
          if (voice.greeting) v.greeting = voice.greeting;
          if (voice.hold_message) v.hold_message = voice.hold_message;
          if (voice.hold_music) v.hold_music = voice.hold_music;
          if (voice.language) v.language = voice.language;
          if (voice.voice_name) v.voice_name = voice.voice_name;
          if (voice.max_record_seconds) v.max_record_seconds = Number(voice.max_record_seconds);
          if (voice.conversational !== undefined) v.conversational = !!voice.conversational;
          if (Object.keys(v).length > 0) {
            config.services[name].voice = v;
          } else {
            delete config.services[name].voice;
          }
        } else {
          delete config.services[name].voice;
        }
      }
      if ('format' in req.body) {
        if (format && format.provider) {
          config.services[name].format = { provider: format.provider, prompt: format.prompt || '' };
          if (format.model) config.services[name].format!.model = format.model;
        } else {
          delete config.services[name].format;
        }
      }
      if (Array.isArray(allow_list) && allow_list.length > 0) {
        config.services[name].allow_list = allow_list;
      } else {
        delete config.services[name].allow_list;
      }
      saveConfig(ctx.configPath, config);
      ctx.reloadRouter?.();
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/config/services/:name — remove a service
  app.delete('/api/config/services/:name', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.services?.[name]) {
        res.status(404).json({ error: `Service "${name}" not found` });
        return;
      }
      delete config.services![name];
      saveConfig(ctx.configPath, config);
      ctx.reloadRouter?.();
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/config/channels — add a new channel
  app.post('/api/config/channels', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name, allow_list, ...fields } = req.body;
    if (!name || !fields.type) {
      res.status(400).json({ error: 'name and type are required' });
      return;
    }
    if (!isValidName(name)) {
      res.status(400).json({ error: 'Name must contain only letters, numbers, hyphens, and underscores' });
      return;
    }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (config.channels[name]) {
        res.status(409).json({ error: `Channel "${name}" already exists` });
        return;
      }
      config.channels[name] = {
        ...fields,
        ...(Array.isArray(allow_list) && allow_list.length > 0 && { allow_list }),
      };
      saveConfig(ctx.configPath, config);
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/config/channels/:name — update channel settings
  app.put('/api/config/channels/:name', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    const { unmatched, allow_list, mode } = req.body;
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.channels[name]) {
        res.status(404).json({ error: `Channel "${name}" not found` });
        return;
      }
      if (mode !== undefined) {
        if (!['service', 'groups'].includes(mode)) {
          res.status(400).json({ error: 'Mode must be "service" or "groups"' });
          return;
        }
        config.channels[name].mode = mode;
      }
      if (unmatched) {
        config.channels[name].unmatched = unmatched;
      } else {
        delete config.channels[name].unmatched;
      }
      if (allow_list !== undefined) {
        if (Array.isArray(allow_list) && allow_list.length > 0) {
          config.channels[name].allow_list = allow_list;
        } else {
          delete config.channels[name].allow_list;
        }
      }
      saveConfig(ctx.configPath, config);
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/config/channels/:name/sms-settings
  app.put('/api/config/channels/:name/sms-settings', async (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    const { inbound_mode, poll_interval } = req.body;

    if (!inbound_mode || !['polling', 'webhook'].includes(inbound_mode)) {
      res.status(400).json({ error: 'inbound_mode must be "polling" or "webhook"' });
      return;
    }

    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const ch = config.channels[name];
      if (!ch) {
        res.status(404).json({ error: `Channel "${name}" not found` });
        return;
      }
      if (ch.type !== 'sms') {
        res.status(400).json({ error: 'Not an SMS channel' });
        return;
      }

      if (inbound_mode === 'webhook' && !ctx.publicUrl) {
        res.status(400).json({ error: 'Service is not externalized. Please externalize first.' });
        return;
      }

      if (inbound_mode === 'polling') {
        ch.poll_interval = parseInt(poll_interval) || 60;
      } else {
        delete ch.poll_interval;
      }

      saveConfig(ctx.configPath, config);

      try {
        const Twilio = (await import('twilio')).default;
        const client = Twilio(ch.account_sid as string, ch.auth_token as string);
        const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: ch.number as string, limit: 1 });
        if (numbers.length > 0) {
          const numberSid = numbers[0].sid;
          if (inbound_mode === 'webhook') {
            const webhookUrl = `${ctx.publicUrl}/inbound/twilio/${name}`;
            await client.incomingPhoneNumbers(numberSid).update({ smsUrl: webhookUrl, smsMethod: 'POST' });
            console.log(`📱 Updated Twilio SMS webhook to ${webhookUrl}`);
          } else {
            await client.incomingPhoneNumbers(numberSid).update({ smsUrl: 'https://api.vapi.ai/twilio/sms', smsMethod: 'POST' });
            console.log(`📱 Reverted Twilio SMS webhook to default`);
          }
        } else {
          console.warn(`⚠️ Twilio number ${ch.number} not found — webhook not updated`);
        }
      } catch (twilioErr: any) {
        console.error(`[sms-settings] Twilio webhook update failed: ${twilioErr.message}`);
      }

      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/config/channels/:name/email-settings
  app.put('/api/config/channels/:name/email-settings', async (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    const { inbound_mode, poll_interval, from_email } = req.body;

    if (!inbound_mode || !['polling', 'webhook'].includes(inbound_mode)) {
      res.status(400).json({ error: 'inbound_mode must be "polling" or "webhook"' });
      return;
    }

    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const ch = config.channels[name];
      if (!ch) {
        res.status(404).json({ error: `Channel "${name}" not found` });
        return;
      }
      if (ch.type !== 'email' || (ch as any).provider !== 'resend') {
        res.status(400).json({ error: 'Not a Resend email channel' });
        return;
      }

      if (inbound_mode === 'webhook' && !ctx.publicUrl) {
        res.status(400).json({ error: 'Service is not externalized. Please externalize first.' });
        return;
      }

      const apiKey = (ch as any).api_key as string;

      if (inbound_mode === 'webhook') {
        if ((ch as any).webhook_id) {
          try {
            await fetch(`https://api.resend.com/webhooks/${(ch as any).webhook_id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${apiKey}` },
            });
          } catch (_) {}
        }

        const webhookUrl = `${ctx.publicUrl}/inbound/resend/${name}`;
        const createRes = await fetch('https://api.resend.com/webhooks', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: webhookUrl, events: ['email.received'] }),
        });

        if (!createRes.ok) {
          const err = await createRes.text();
          res.status(502).json({ error: `Resend webhook creation failed: ${err}` });
          return;
        }

        const result = await createRes.json() as { id: string; signing_secret?: string };
        (ch as any).webhook_id = result.id;
        if (result.signing_secret) (ch as any).webhook_secret = result.signing_secret;
        delete ch.poll_interval;
        console.log(`📬 Registered Resend inbound webhook for "${name}" → ${webhookUrl}`);
      } else {
        if ((ch as any).webhook_id) {
          try {
            await fetch(`https://api.resend.com/webhooks/${(ch as any).webhook_id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            console.log(`📬 Removed Resend webhook for "${name}"`);
          } catch (e: any) {
            console.error(`[email-settings] Failed to delete Resend webhook: ${e.message}`);
          }
          delete (ch as any).webhook_id;
          delete (ch as any).webhook_secret;
        }
        ch.poll_interval = parseInt(poll_interval) || 30;
      }

      if (from_email && typeof from_email === 'string') {
        (ch as any).from_email = from_email.trim();
      }

      saveConfig(ctx.configPath, config);
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/config/channels/:name/secret — return the raw secret for clipboard copy
  app.get('/api/config/channels/:name/secret', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const ch = config.channels[req.params.name];
      if (!ch) { res.status(404).json({ error: 'Channel not found' }); return; }
      res.json({ secret: (ch as any).secret || '' });
    } catch (err: any) {
      console.error('[config]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/config/channels/:name — remove a channel and its dependent services
  app.delete('/api/config/channels/:name', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.channels[name]) {
        res.status(404).json({ error: `Channel "${name}" not found` });
        return;
      }
      delete config.channels[name];
      if (config.services) {
        for (const [svcName, svc] of Object.entries(config.services)) {
          if (svc.channel === name) delete config.services[svcName];
        }
      }
      saveConfig(ctx.configPath, config);
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/config/channels/:name/reconnect — reconnect a WhatsApp channel using existing auth
  app.post('/api/config/channels/:name/reconnect', async (req, res) => {
    const { name } = req.params;
    try {
      const existing = ctx.channels.get(name) as WhatsAppChannel | undefined;
      if (!existing) { res.status(404).json({ error: `Channel "${name}" not found or not running` }); return; }

      // Disconnect first to stop any reconnect loop
      await existing.disconnect().catch(() => {});

      res.json({ ok: true, message: 'Reconnecting...' });

      // Re-connect with existing auth state
      existing.connect().catch((err: any) => {
        console.error(`[config] Reconnect failed for ${name}:`, err.message);
      });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/config/channels/:name/pair — trigger WhatsApp QR pairing
  app.post('/api/config/channels/:name/pair', async (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const ch = config.channels[name];
      if (!ch) { res.status(404).json({ error: `Channel "${name}" not found` }); return; }
      if (ch.type !== 'whatsapp') { res.status(400).json({ error: 'Only WhatsApp channels support QR pairing' }); return; }

      // Initialize pair state for polling
      pairState.set(name, { qr: null, status: 'waiting' });

      const existing = ctx.channels.get(name) as WhatsAppChannel | undefined;
      if (existing) {
        await existing.disconnect().catch(() => {});
      }

      const { rm } = await import('fs/promises');
      const { join } = await import('path');
      const authDir = join(DEFAULT_AUTH_DIR, `whatsapp-${name}`);
      await rm(authDir, { recursive: true, force: true });

      const channel = existing || new WhatsAppChannel(name, ch as any);

      const onQR = (qr: string) => {
        pairState.set(name, { qr, status: 'waiting' });
      };
      const onConnected = () => {
        pairState.set(name, { qr: null, status: 'paired' });
        channel.removeListener('qr', onQR);
        channel.removeListener('connected', onConnected);
        if (!existing) channel.disconnect().catch(() => {});
      };

      channel.on('qr', onQR);
      channel.on('connected', onConnected);

      channel.connect().catch((err: any) => {
        pairState.set(name, { qr: null, status: 'error', error: err.message });
      });

      if (!existing) {
        setTimeout(() => { channel.disconnect().catch(() => {}); }, 65000);
      }

      res.json({ ok: true, message: 'Pairing started.' });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/config/channels/:name/pair-status — poll for QR code during pairing
  app.get('/api/config/channels/:name/pair-status', (_req, res) => {
    const { name } = _req.params;
    const state = pairState.get(name);
    if (!state) { res.json({ status: 'idle' }); return; }
    res.json(state);
  });

  // POST /api/config/channels/:name/gmail-auth — trigger Gmail OAuth flow
  app.post('/api/config/channels/:name/gmail-auth', async (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const ch = config.channels[name];
      if (!ch) { res.status(404).json({ error: `Channel "${name}" not found` }); return; }
      if (ch.type !== 'email' || (ch as any).provider !== 'gmail') {
        res.status(400).json({ error: 'Only Gmail channels support OAuth' }); return;
      }

      const emailConfig = ch as any;
      const http = await import('http');
      const { join, dirname } = await import('path');
      const { existsSync, mkdirSync, writeFileSync } = await import('fs');

      // Check if already authenticated
      const tokenPath = join(DEFAULT_AUTH_DIR, `gmail-${name}.json`);
      if (existsSync(tokenPath)) {
        try {
          const tokens = JSON.parse(require('fs').readFileSync(tokenPath, 'utf-8'));
          if (tokens?.refresh_token) {
            res.json({ ok: true, already_authenticated: true });
            ctx.broadcast({ type: 'gmail-auth-success', channel: name });
            return;
          }
        } catch {}
      }

      // Start a temporary HTTP server for the OAuth callback
      const server = http.createServer(async (cbReq, cbRes) => {
        const url = new URL(cbReq.url || '/', `http://localhost`);
        const authCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          cbRes.writeHead(200, { 'Content-Type': 'text/html' });
          cbRes.end('<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Authorization failed</h2><p>You can close this tab and return to the dashboard.</p></body></html>');
          server.close();
          ctx.broadcast({ type: 'gmail-auth-error', channel: name, error: `OAuth error: ${error}` });
          return;
        }

        if (!authCode) {
          cbRes.writeHead(400, { 'Content-Type': 'text/plain' });
          cbRes.end('Missing code parameter');
          return;
        }

        // Exchange code for tokens
        try {
          const addr = server.address() as { port: number };
          const redirectUri = `http://localhost:${addr.port}`;
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code: authCode,
              client_id: emailConfig.client_id,
              client_secret: emailConfig.client_secret,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
            }),
          });

          if (!tokenRes.ok) {
            const err = await tokenRes.text();
            throw new Error(`Token exchange failed: ${err}`);
          }

          const data = await tokenRes.json() as any;
          const tokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expiry: Date.now() + (data.expires_in * 1000),
          };

          // Save tokens
          const dir = dirname(tokenPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

          cbRes.writeHead(200, { 'Content-Type': 'text/html' });
          cbRes.end('<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Gmail authenticated successfully!</h2><p>You can close this tab and return to the dashboard.</p></body></html>');
          server.close();
          ctx.broadcast({ type: 'gmail-auth-success', channel: name });
        } catch (err: any) {
          cbRes.writeHead(200, { 'Content-Type': 'text/html' });
          cbRes.end(`<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Authentication failed</h2><p>${err.message}</p></body></html>`);
          server.close();
          ctx.broadcast({ type: 'gmail-auth-error', channel: name, error: err.message });
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address() as { port: number };
      const redirectUri = `http://localhost:${addr.port}`;

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(emailConfig.client_id)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.modify')}` +
        `&access_type=offline` +
        `&prompt=consent`;

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        ctx.broadcast({ type: 'gmail-auth-error', channel: name, error: 'OAuth timeout — no callback received within 2 minutes' });
      }, 120000);

      res.json({ ok: true, auth_url: authUrl });
      ctx.broadcast({ type: 'gmail-auth-url', channel: name, authUrl });
    } catch (err: any) {
      console.error('[config]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
