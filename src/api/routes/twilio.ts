import { Express } from 'express';
import { ServerContext } from '../types';
import { TwilioProvisioner } from '../../provisioning/twilio';
import Twilio from 'twilio';

// Active SMS listeners keyed by phone number
const activeSmsListeners = new Map<string, { timer: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }>();

export function registerTwilioRoutes(app: Express, ctx: ServerContext): void {
  app.post('/api/twilio/list-numbers', async (req, res) => {
    const { account_sid, auth_token } = req.body;
    if (!account_sid || !auth_token) {
      res.status(400).json({ error: 'account_sid and auth_token are required' });
      return;
    }
    try {
      const provisioner = new TwilioProvisioner({ accountSid: account_sid, authToken: auth_token });
      const numbers = await provisioner.listOwnedNumbers();
      res.json({ numbers });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/twilio/search-numbers', async (req, res) => {
    const { account_sid, auth_token, country_code, type, limit } = req.body;
    if (!account_sid || !auth_token || !country_code) {
      res.status(400).json({ error: 'account_sid, auth_token, and country_code are required' });
      return;
    }
    try {
      const provisioner = new TwilioProvisioner({ accountSid: account_sid, authToken: auth_token });
      const numbers = await provisioner.searchNumbers(country_code, {
        type: type || 'mobile',
        limit: limit || 10,
      });
      res.json({ numbers });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/twilio/buy-number', async (req, res) => {
    const { account_sid, auth_token, phone_number } = req.body;
    if (!account_sid || !auth_token || !phone_number) {
      res.status(400).json({ error: 'account_sid, auth_token, and phone_number are required' });
      return;
    }
    try {
      const provisioner = new TwilioProvisioner({ accountSid: account_sid, authToken: auth_token });
      const purchased = await provisioner.purchaseNumber(phone_number);
      res.json({ ok: true, purchased });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/twilio/listen-sms', async (req, res) => {
    const { account_sid, auth_token, number } = req.body;
    if (!account_sid || !auth_token || !number) {
      res.status(400).json({ error: 'account_sid, auth_token, and number are required' });
      return;
    }

    // Stop any existing listener for this number
    const existing = activeSmsListeners.get(number);
    if (existing) {
      clearInterval(existing.timer);
      clearTimeout(existing.timeout);
      activeSmsListeners.delete(number);
    }

    const client = Twilio(account_sid, auth_token);
    const seenSids = new Set<string>();
    // Seed with current messages so we only show NEW ones arriving after listener starts
    let seeded = false;

    const poll = async () => {
      try {
        const messages = await client.messages.list({
          to: number,
          limit: 20,
        });
        for (const msg of messages) {
          if (!seenSids.has(msg.sid)) {
            seenSids.add(msg.sid);
            if (seeded) {
              ctx.broadcast({
                type: 'sms-listen',
                number,
                message: { from: msg.from, body: msg.body, date: msg.dateSent?.toISOString() || new Date().toISOString() },
              });
            }
          }
        }
        seeded = true;
      } catch (err: any) {
        // Broadcast error once then stop
        ctx.broadcast({ type: 'sms-listen-error', number, error: err.message });
        const entry = activeSmsListeners.get(number);
        if (entry) {
          clearInterval(entry.timer);
          clearTimeout(entry.timeout);
          activeSmsListeners.delete(number);
        }
      }
    };

    const timer = setInterval(poll, 4000);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      activeSmsListeners.delete(number);
      ctx.broadcast({ type: 'sms-listen-stopped', number });
    }, 5 * 60 * 1000); // auto-stop after 5 minutes

    activeSmsListeners.set(number, { timer, timeout });

    // Do an initial poll immediately
    poll();
    res.json({ ok: true });
  });

  app.post('/api/twilio/stop-listen-sms', async (req, res) => {
    const { number } = req.body;
    if (!number) { res.status(400).json({ error: 'number is required' }); return; }
    const entry = activeSmsListeners.get(number);
    if (entry) {
      clearInterval(entry.timer);
      clearTimeout(entry.timeout);
      activeSmsListeners.delete(number);
      ctx.broadcast({ type: 'sms-listen-stopped', number });
    }
    res.json({ ok: true });
  });
}
