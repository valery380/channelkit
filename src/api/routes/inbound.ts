import express, { Express } from 'express';
import { ServerContext } from '../types';

export function registerInboundRoutes(app: Express, ctx: ServerContext): void {
  // POST /inbound/voice/:channel — Twilio Voice incoming call
  app.post('/inbound/voice/:channel', express.urlencoded({ extended: false }), (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleIncomingCall) {
      res.type('text/xml').send('<Response><Say>Service unavailable.</Say><Hangup/></Response>');
      return;
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
      res.status(404).json({ error: `Endpoint channel "${channelName}" not found` });
      return;
    }

    const endpointChannel = channel as any;
    const cfg = endpointChannel.cfg;

    // Validate HTTP method
    const allowedMethod = (cfg.method || 'POST').toUpperCase();
    if (req.method !== allowedMethod) {
      res.status(405).json({ error: `Method ${req.method} not allowed. Expected ${allowedMethod}` });
      return;
    }

    // Validate secret
    if (cfg.secret) {
      const provided = req.headers['x-channel-secret'];
      if (provided !== cfg.secret) {
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
      res.status(500).json({ error: err.message });
    }
  });

  // POST /inbound/resend/:channel — Resend inbound email webhook
  app.post('/inbound/resend/:channel', (req, res) => {
    const channelName = req.params.channel;
    const channel = ctx.channels.get(channelName);
    if (!channel || !(channel as any).handleInbound) {
      res.status(404).json({ error: `Channel "${channelName}" not found or not a Resend channel` });
      return;
    }
    try {
      (channel as any).handleInbound(req.body);
      res.json({ ok: true });
    } catch (err: any) {
      console.error(`[resend-inbound] Error:`, err);
      res.status(500).json({ error: err.message });
    }
  });
}
