import { Express } from 'express';
import { ServerContext } from '../types';
import { TwilioProvisioner } from '../../provisioning/twilio';

export function registerTwilioRoutes(app: Express, ctx: ServerContext): void {
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });
}
