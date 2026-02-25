import { resolve, join } from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { banner, c, ask, select } from '../helpers';
import { serviceAddWizard } from '../wizards/service';
import { startCommand } from './start';

export async function initCommand() {
  banner();
  console.log(c('bright', '  Welcome to ChannelKit! Let\'s get you set up.\n'));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const channelIdx = await select(rl, 'Which channel do you want to connect?', [
      '📱 WhatsApp — connect with your phone number',
      '💬 Telegram — create a bot',
      '📧 Email — Gmail or Resend',
      '📲 SMS — Twilio',
      '📞 Voice — Twilio',
    ]);

    const channels: Record<string, any> = {};
    const services: Record<string, any> = {};
    let channelName = '';

    if (channelIdx === 0) {
      console.log();
      const number = await ask(rl, 'Your WhatsApp phone number (with country code):', '+972...');
      channelName = 'whatsapp';
      channels[channelName] = { type: 'whatsapp', number };

    } else if (channelIdx === 1) {
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
      channels[channelName] = { type: 'telegram', bot_token: token };

    } else if (channelIdx === 2) {
      console.log();
      const emailProviderIdx = await select(rl, 'Which email provider?', [
        '📧 Gmail — OAuth2, polling (no public URL needed)',
        '📨 Resend — API + inbound webhooks (needs public URL)',
      ]);

      if (emailProviderIdx === 0) {
        console.log(c('bright', '\n  📝 Gmail OAuth Setup:\n'));
        console.log(c('dim', '  You need a Google Cloud project with Gmail API enabled.'));
        console.log(c('dim', '  Create OAuth2 credentials (Desktop app) at:'));
        console.log(c('cyan', '  https://console.cloud.google.com/apis/credentials\n'));
        const clientId = await ask(rl, 'OAuth Client ID:');
        const clientSecret = await ask(rl, 'OAuth Client Secret:');
        const pollInterval = await ask(rl, 'Poll interval (seconds):', '30');
        channelName = 'gmail';
        channels[channelName] = { type: 'email', provider: 'gmail', client_id: clientId, client_secret: clientSecret, poll_interval: parseInt(pollInterval) || 30 };
      } else {
        console.log(c('bright', '\n  📝 Resend Setup:\n'));
        console.log(c('dim', '  You need a Resend account with a verified domain.'));
        console.log(c('dim', '  Get your API key at: https://resend.com/api-keys\n'));
        const apiKey = await ask(rl, 'Resend API Key:');
        const fromEmail = await ask(rl, 'Sender email (verified domain):', 'noreply@yourdomain.com');
        channelName = 'resend';
        channels[channelName] = { type: 'email', provider: 'resend', api_key: apiKey, from_email: fromEmail };
      }

    } else if (channelIdx === 3) {
      console.log(c('bright', '\n  📝 Twilio SMS Setup:\n'));
      console.log(c('dim', '  You need a Twilio account with a phone number.'));
      console.log(c('dim', '  Get credentials at: https://console.twilio.com\n'));
      const accountSid = await ask(rl, 'Account SID:');
      const authToken = await ask(rl, 'Auth Token:');
      const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');
      const pollInterval = await ask(rl, 'Poll interval in seconds (0 = webhook mode):', '10');
      channelName = 'sms';
      channels[channelName] = {
        type: 'sms', provider: 'twilio', account_sid: accountSid, auth_token: authToken, number,
        ...(parseInt(pollInterval) > 0 ? { poll_interval: parseInt(pollInterval) } : {}),
      };

    } else if (channelIdx === 4) {
      console.log(c('bright', '\n  📝 Twilio Voice Setup:\n'));
      console.log(c('dim', '  Same Twilio account as SMS — uses a phone number for voice calls.\n'));
      const existingSms = Object.values(channels).find((ch: any) => ch.type === 'sms' && ch.provider === 'twilio') as any;
      let accountSid: string;
      let authToken: string;

      if (existingSms) {
        const reuse = await ask(rl, `Reuse Twilio credentials from SMS channel? (Y/n):`, 'Y');
        if (reuse.toLowerCase() !== 'n') {
          accountSid = existingSms.account_sid;
          authToken = existingSms.auth_token;
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
      channelName = 'voice';
      channels[channelName] = { type: 'voice', provider: 'twilio', account_sid: accountSid, auth_token: authToken, number };
      console.log(c('yellow', '\n  ⚠️  Voice requires a public URL. Use --tunnel or --public-url when starting.\n'));
    }

    console.log();
    const configPath = await ask(rl, 'Config file path:', 'config.yaml');

    let yaml = `# ChannelKit Configuration\n# Generated by channelkit init\n\nchannels:\n`;
    for (const [name, cfg] of Object.entries(channels)) {
      yaml += `  ${name}:\n`;
      for (const [key, value] of Object.entries(cfg as any)) {
        yaml += `    ${key}: "${value}"\n`;
      }
    }

    if (Object.keys(services).length > 0) {
      yaml += `\nservices:\n`;
      for (const [name, svc] of Object.entries(services)) {
        yaml += `  ${name}:\n`;
        yaml += `    channel: "${(svc as any).channel}"\n`;
        yaml += `    webhook: "${(svc as any).webhook}"\n`;
      }
    } else {
      yaml += `\nservices: {}\n`;
    }

    const fullPath = resolve(configPath);
    if (existsSync(fullPath)) {
      const overwrite = await ask(rl, `${configPath} already exists. Overwrite? (y/N):`, 'N');
      if (overwrite.toLowerCase() !== 'y') {
        console.log(c('yellow', '\n  Aborted. Config not written.\n'));
        rl.close();
        return;
      }
    }

    writeFileSync(fullPath, yaml);

    if (!existsSync('auth')) {
      mkdirSync('auth');
    }

    console.log();
    console.log(c('green', '  ╔═══════════════════════════════════════╗'));
    console.log(c('green', '  ║                                       ║'));
    console.log(c('green', '  ║   ✅ Config created successfully!     ║'));
    console.log(c('green', '  ║                                       ║'));
    console.log(c('green', '  ╚═══════════════════════════════════════╝'));
    console.log();
    console.log(c('white', '  Next steps:\n'));
    console.log(c('dim', '    1. Set up a service (webhook binding)'));
    console.log(c('dim', '    2. Start ChannelKit:\n'));
    console.log(c('cyan', '       npm start'));
    console.log();
    
    if (channels['whatsapp']) {
      console.log(c('bright', '  Let\'s connect your WhatsApp now. Scan the QR code:\n'));
      console.log(c('dim', '  Open WhatsApp → Settings → Linked Devices → Link a Device\n'));
      try {
        const { WhatsAppChannel } = await import('../../channels/whatsapp');
        const authPath = join('.', 'auth', `whatsapp-whatsapp`);
        await WhatsAppChannel.pair(authPath);
        console.log(c('green', '\n  ✅ WhatsApp connected!\n'));
      } catch (err: any) {
        console.log(c('yellow', `\n  ⚠️  Pairing failed: ${err.message}`));
        console.log(c('dim', '  You can scan the QR code later when you start ChannelKit.\n'));
      }
    }

    const setupServiceNow = await ask(rl, 'Set up a service now? (Y/n):', 'Y');
    if (setupServiceNow.toLowerCase() !== 'n') {
      console.log();
      await serviceAddWizard({ config: fullPath }, rl);
    }

    const startNow = await ask(rl, 'Start ChannelKit now? (Y/n):', 'Y');
    rl.close();

    if (startNow.toLowerCase() !== 'n') {
      console.log();
      await startCommand(fullPath);
    }

  } catch (err) {
    rl.close();
    throw err;
  }
}
