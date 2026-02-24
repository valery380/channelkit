import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig } from '../../config/parser';
import { c } from '../helpers';

export async function sendCommand(channelName: string, number: string, message: string, opts: { config: string; port: string }) {
  const jid = number.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  const port = parseInt(opts.port, 10);
  const baseUrl = `http://localhost:${port}`;
  const url = `${baseUrl}/api/send/${encodeURIComponent(channelName)}/${encodeURIComponent(jid)}`;

  const configPath = resolve(opts.config);
  let secret: string | undefined;
  if (existsSync(configPath)) {
    try {
      const config = loadConfig(configPath, { validate: false });
      secret = config.api_secret;
    } catch {}
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: message }),
    });
    const data = await res.json() as any;
    if (res.ok) {
      console.log(c('green', `  ✅ Message sent to ${number} via ${channelName}`));
    } else {
      console.error(c('yellow', `  ❌ ${data.error || 'Failed to send'}`));
      process.exit(1);
    }
  } catch (err: any) {
    console.error(c('yellow', `  ❌ Could not connect to ChannelKit at ${baseUrl}`));
    console.error(c('dim', `  Make sure ChannelKit is running (channelkit start)`));
    process.exit(1);
  }
}
