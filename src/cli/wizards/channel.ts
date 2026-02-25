import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { c, ask, select } from '../helpers';

export async function channelAddWizard(opts: { config: string }) {
  const configPath = resolve(opts.config);
  if (!existsSync(configPath)) {
    console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n  Run 'channelkit init' first.\n`));
    process.exit(1);
  }

  const { loadConfig, saveConfig } = await import('../../config/parser');
  const config = loadConfig(configPath);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(c('cyan', '\n  📡 Add a new channel\n'));

    const channelIdx = await select(rl, 'Which channel do you want to add?', [
      '📱 WhatsApp — connect with your phone number',
      '💬 Telegram — create a bot',
      '📧 Email — Gmail or Resend',
      '📲 SMS — Twilio',
      '📞 Voice — Twilio',
    ]);

    let channelName: string = '';
    let channelConfig: any = {};

    if (channelIdx === 0) {
      const existingWa = Object.entries(config.channels).find(([, v]) => (v as any).type === 'whatsapp');
      if (existingWa) {
        const overwrite = await ask(rl, `WhatsApp channel "${existingWa[0]}" already exists. Replace? (y/N):`, 'N');
        if (overwrite.toLowerCase() !== 'y') { rl.close(); return; }
        delete config.channels[existingWa[0]];
        if (config.services) { for (const [k, v] of Object.entries(config.services)) { if (v.channel === existingWa[0]) delete config.services[k]; } }
        config.routes = (config.routes || []).filter(r => r.channel !== existingWa[0]);
      }

      console.log();
      const number = await ask(rl, 'Your WhatsApp phone number (with country code):', '+972...');
      const modeIdx = await select(rl, 'How will you use this channel?', [
        '👥 Groups mode — one number for multiple services',
        '📱 Service mode — one number for one service',
      ]);

      channelName = 'whatsapp';
      channelConfig = { type: 'whatsapp', number, mode: modeIdx === 0 ? 'groups' : 'direct' };

    } else if (channelIdx === 1) {
      const existingTg = Object.entries(config.channels).find(([, v]) => (v as any).type === 'telegram');
      if (existingTg) {
        const overwrite = await ask(rl, `Telegram channel "${existingTg[0]}" already exists. Replace? (y/N):`, 'N');
        if (overwrite.toLowerCase() !== 'y') { rl.close(); return; }
        delete config.channels[existingTg[0]];
        if (config.services) { for (const [k, v] of Object.entries(config.services)) { if (v.channel === existingTg[0]) delete config.services[k]; } }
        config.routes = (config.routes || []).filter(r => r.channel !== existingTg[0]);
      }

      console.log();
      console.log(c('bright', '  📝 Quick setup — takes 30 seconds:\n'));
      console.log(c('white', '  1.') + c('dim', ' Open Telegram and search for ') + c('cyan', '@BotFather'));
      console.log(c('white', '  2.') + c('dim', ' Send ') + c('cyan', '/newbot'));
      console.log(c('white', '  3.') + c('dim', ' Choose a name (e.g. "My Service Bot")'));
      console.log(c('white', '  4.') + c('dim', ' Choose a username (e.g. "myservice_bot")'));
      console.log(c('white', '  5.') + c('dim', ' Copy the token BotFather gives you\n'));

      const openLink = await ask(rl, 'Open BotFather in browser? (Y/n):', 'Y');
      if (openLink.toLowerCase() !== 'n') {
        const { exec: execCmd } = await import('child_process');
        execCmd('open "https://t.me/BotFather" 2>/dev/null || xdg-open "https://t.me/BotFather" 2>/dev/null');
      }

      console.log();
      const token = await ask(rl, 'Paste the bot token here:');
      if (!token || !token.includes(':')) {
        console.log(c('yellow', '\n  ⚠️  That doesn\'t look like a valid token. It should look like: 123456:ABC-DEF...\n'));
        rl.close();
        return;
      }

      console.log(c('dim', '\n  Verifying token...'));
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await res.json() as any;
        if (data.ok) {
          console.log(c('green', `  ✅ Connected to @${data.result.username} (${data.result.first_name})\n`));
        } else {
          console.log(c('yellow', `\n  ❌ Invalid token: ${data.description}\n`));
          rl.close();
          return;
        }
      } catch {
        console.log(c('yellow', '\n  ⚠️  Could not verify token (no internet?). Continuing anyway.\n'));
      }

      channelName = 'telegram';
      channelConfig = { type: 'telegram', bot_token: token };

    } else if (channelIdx === 2) {
      console.log();
      const providerIdx = await select(rl, 'Which email provider?', [
        '📧 Gmail — OAuth2, polling (no public URL needed)',
        '📨 Resend — API + inbound webhooks (needs public URL)',
      ]);

      if (providerIdx === 0) {
        console.log(c('bright', '\n  📝 Gmail OAuth Setup:\n'));
        console.log(c('dim', '  You need a Google Cloud project with Gmail API enabled.'));
        console.log(c('dim', '  Create OAuth2 credentials (Desktop app) at:'));
        console.log(c('cyan', '  https://console.cloud.google.com/apis/credentials\n'));
        const clientId = await ask(rl, 'OAuth Client ID:');
        const clientSecret = await ask(rl, 'OAuth Client Secret:');
        const pollInterval = await ask(rl, 'Poll interval (seconds):', '30');
        channelName = await ask(rl, 'Channel name:', 'gmail');
        channelConfig = { type: 'email', provider: 'gmail', client_id: clientId, client_secret: clientSecret, poll_interval: parseInt(pollInterval) || 30 };
      } else {
        console.log(c('bright', '\n  📝 Resend Setup:\n'));
        console.log(c('dim', '  You need a Resend account with a verified domain.'));
        console.log(c('dim', '  Get your API key at: https://resend.com/api-keys\n'));
        const apiKey = await ask(rl, 'Resend API Key:');
        const fromEmail = await ask(rl, 'Sender email (verified domain):', 'noreply@yourdomain.com');
        channelName = await ask(rl, 'Channel name:', 'resend');
        channelConfig = { type: 'email', provider: 'resend', api_key: apiKey, from_email: fromEmail };
        console.log(c('dim', `\n  📬 Configure Resend inbound webhook to:`));
        console.log(c('cyan', `     <your-public-url>/inbound/resend/${channelName}\n`));
      }

    } else if (channelIdx === 3) {
      console.log(c('bright', '\n  📝 Twilio SMS Setup:\n'));
      console.log(c('dim', '  You need a Twilio account with a phone number.'));
      console.log(c('dim', '  Get credentials at: https://console.twilio.com\n'));
      const accountSid = await ask(rl, 'Account SID:');
      const authToken = await ask(rl, 'Auth Token:');
      const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');
      const pollInterval = await ask(rl, 'Poll interval in seconds (0 = webhook mode):', '10');
      channelName = await ask(rl, 'Channel name:', 'sms');
      channelConfig = {
        type: 'sms', provider: 'twilio', account_sid: accountSid, auth_token: authToken, number,
        ...(parseInt(pollInterval) > 0 ? { poll_interval: parseInt(pollInterval) } : {}),
      };

    } else if (channelIdx === 4) {
      console.log(c('bright', '\n  📝 Twilio Voice Setup:\n'));
      const existingSms = Object.entries(config.channels).find(([, v]) => (v as any).type === 'sms' && (v as any).provider === 'twilio');
      let accountSid: string;
      let authToken: string;

      if (existingSms) {
        const smsCfg = existingSms[1] as any;
        const reuse = await ask(rl, `Reuse Twilio credentials from "${existingSms[0]}" channel? (Y/n):`, 'Y');
        if (reuse.toLowerCase() !== 'n') {
          accountSid = smsCfg.account_sid;
          authToken = smsCfg.auth_token;
          console.log(c('dim', '  Using existing Twilio credentials.\n'));
        } else {
          accountSid = await ask(rl, 'Account SID:');
          authToken = await ask(rl, 'Auth Token:');
        }
      } else {
        accountSid = await ask(rl, 'Account SID:');
        authToken = await ask(rl, 'Auth Token:');
      }

      const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');
      channelName = await ask(rl, 'Channel name:', 'voice');
      channelConfig = { type: 'voice', provider: 'twilio', account_sid: accountSid, auth_token: authToken, number };
      console.log(c('yellow', '\n  ⚠️  Voice requires a public URL. Use --tunnel or --public-url when starting.\n'));
    }

    config.channels[channelName] = channelConfig;
    saveConfig(configPath, config);

    console.log(c('green', `\n  ✅ Channel "${channelName}" added!\n`));

    if (channelConfig.type === 'whatsapp') {
      console.log(c('bright', '  Let\'s connect your WhatsApp now. Scan the QR code:\n'));
      console.log(c('dim', '  Open WhatsApp → Settings → Linked Devices → Link a Device\n'));
      try {
        const { WhatsAppChannel } = await import('../../channels/whatsapp');
        const authPath = join('.', 'auth', `whatsapp-${channelName}`);
        await WhatsAppChannel.pair(authPath);
        console.log(c('green', '\n  ✅ WhatsApp connected!\n'));
      } catch (err: any) {
        console.log(c('yellow', `\n  ⚠️  Pairing failed: ${err.message}`));
        console.log(c('dim', '  You can scan the QR code later when you start ChannelKit.\n'));
      }
    } else if (channelName === 'telegram') {
      console.log(c('dim', '  Start ChannelKit to activate the Telegram bot.\n'));
    }

    const modeOptions = [
      '📦 Single service — one webhook for all messages',
      '📦 Multiple services — route to different webhooks (WhatsApp: magic codes, Telegram: slash commands)',
    ];
    const modeIdx = await select(rl, 'How will this channel be used?', modeOptions);

    if (modeIdx === 0) {
      const webhook = await ask(rl, 'Webhook URL:', 'http://localhost:3000');
      if (!config.services) config.services = {};
      const svcName = channelName;
      config.services[svcName] = { channel: channelName, webhook };
      saveConfig(configPath, config);
      console.log(c('green', `\n  ✅ Service "${svcName}" created → ${webhook}\n`));
    } else {
      console.log(c('dim', '\n  Run `channelkit service add` to add services to this channel.\n'));
    }
  } finally {
    rl.close();
  }
}
