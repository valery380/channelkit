import { Express } from 'express';
import { ServerContext } from '../types';
import { loadConfig, saveConfig } from '../../config/parser';
import { WhatsAppChannel } from '../../channels/whatsapp';

export function registerConfigRoutes(app: Express, ctx: ServerContext): void {
  // GET /api/config — return channels and services from config file
  app.get('/api/config', (_req, res) => {
    if (!ctx.configPath) {
      res.status(503).json({ error: 'Config path not set' });
      return;
    }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      res.json({ channels: config.channels, services: config.services || {}, api_secret: config.api_secret || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/config/services/:name — update service fields
  app.put('/api/config/services/:name', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    const { name } = req.params;
    const { webhook, code, command, stt, tts, format, allow_list, method, auth } = req.body;
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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

      const { rm } = await import('fs/promises');
      const { join } = await import('path');
      const authDir = join(process.cwd(), 'auth', `whatsapp-${name}`);

      await rm(authDir, { recursive: true, force: true });

      res.json({ ok: true, message: 'Pairing started. Watch for QR code.' });

      const tempChannel = new WhatsAppChannel(name, ch as any);
      const QRCode = await import('qrcode');

      tempChannel.on('qr', async (qr: string) => {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
          ctx.broadcast({ type: 'whatsapp-qr', channel: name, dataUrl });
        } catch {
          ctx.broadcast({ type: 'whatsapp-qr', channel: name, dataUrl: null });
        }
      });

      tempChannel.on('connected', () => {
        ctx.broadcast({ type: 'whatsapp-paired', channel: name });
        tempChannel.disconnect().catch(() => {});
      });

      tempChannel.connect().catch((err: any) => {
        ctx.broadcast({ type: 'whatsapp-pair-error', channel: name, error: err.message });
      });

      setTimeout(() => {
        tempChannel.disconnect().catch(() => {});
      }, 65000);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
