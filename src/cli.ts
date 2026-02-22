#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { loadConfig } from './config/parser';
import { ChannelKit } from './index';

const LOGO = `
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║     📱 ──┐                            ║
  ║     💬 ──┤──→ ChannelKit ──→ 🔗 App   ║
  ║     📞 ──┘                            ║
  ║                                       ║
  ║     Messaging ingress for your app    ║
  ║                                       ║
  ╚═══════════════════════════════════════╝
`;

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function banner() {
  console.log(c('cyan', LOGO));
  console.log(c('dim', `  v0.1.0\n`));
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? c('dim', ` (${defaultVal})`) : '';
  return new Promise((resolve) => {
    rl.question(`  ${c('green', '?')} ${question}${suffix} `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function select(rl: ReturnType<typeof createInterface>, question: string, options: string[]): Promise<number> {
  console.log(`\n  ${c('green', '?')} ${question}\n`);
  options.forEach((opt, i) => {
    console.log(`    ${c('cyan', `${i + 1})`)} ${opt}`);
  });
  console.log();
  
  while (true) {
    const answer = await ask(rl, `Choose ${c('dim', `[1-${options.length}]`)}:`);
    const num = parseInt(answer);
    if (num >= 1 && num <= options.length) return num - 1;
    console.log(c('yellow', '    Please enter a valid number'));
  }
}

async function initCommand() {
  banner();
  console.log(c('bright', '  Welcome to ChannelKit! Let\'s get you set up.\n'));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Step 1: Channel selection
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
      // WhatsApp
      console.log();
      const number = await ask(rl, 'Your WhatsApp phone number (with country code):', '+972...');
      
      const modeIdx = await select(rl, 'How will you use this channel?', [
        '👤 Personal — route messages from groups on your number',
        '🏢 Service — dedicated number, every incoming message routed',
      ]);

      channelName = 'whatsapp';
      channels[channelName] = {
        type: 'whatsapp',
        number: number,
      };

    } else if (channelIdx === 1) {
      // Telegram
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

      // Verify token by calling getMe
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
      channels[channelName] = {
        type: 'telegram',
        bot_token: token,
      };

    } else if (channelIdx === 2) {
      // Email
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
        channels[channelName] = {
          type: 'email',
          provider: 'gmail',
          client_id: clientId,
          client_secret: clientSecret,
          poll_interval: parseInt(pollInterval) || 30,
        };
      } else {
        console.log(c('bright', '\n  📝 Resend Setup:\n'));
        console.log(c('dim', '  You need a Resend account with a verified domain.'));
        console.log(c('dim', '  Get your API key at: https://resend.com/api-keys\n'));

        const apiKey = await ask(rl, 'Resend API Key:');
        const fromEmail = await ask(rl, 'Sender email (verified domain):', 'noreply@yourdomain.com');

        channelName = 'resend';
        channels[channelName] = {
          type: 'email',
          provider: 'resend',
          api_key: apiKey,
          from_email: fromEmail,
        };
      }

    } else if (channelIdx === 3) {
      // SMS (Twilio)
      console.log(c('bright', '\n  📝 Twilio SMS Setup:\n'));
      console.log(c('dim', '  You need a Twilio account with a phone number.'));
      console.log(c('dim', '  Get credentials at: https://console.twilio.com\n'));

      const accountSid = await ask(rl, 'Account SID:');
      const authToken = await ask(rl, 'Auth Token:');
      const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');
      const pollInterval = await ask(rl, 'Poll interval in seconds (0 = webhook mode):', '10');

      channelName = 'sms';
      channels[channelName] = {
        type: 'sms',
        provider: 'twilio',
        account_sid: accountSid,
        auth_token: authToken,
        number,
        ...(parseInt(pollInterval) > 0 ? { poll_interval: parseInt(pollInterval) } : {}),
      };
    } else if (channelIdx === 4) {
      // Voice (Twilio)
      console.log(c('bright', '\n  📝 Twilio Voice Setup:\n'));
      console.log(c('dim', '  Same Twilio account as SMS — uses a phone number for voice calls.\n'));

      const accountSid = await ask(rl, 'Account SID:');
      const authToken = await ask(rl, 'Auth Token:');
      const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');

      channelName = 'voice';
      channels[channelName] = {
        type: 'voice',
        provider: 'twilio',
        account_sid: accountSid,
        auth_token: authToken,
        number,
      };

      console.log(c('yellow', '\n  ⚠️  Voice requires a public URL. Use --tunnel or --public-url when starting.\n'));
    }

    // Step 2: Generate config
    console.log();
    const configPath = await ask(rl, 'Config file path:', 'config.yaml');

    // Build YAML manually for nice formatting
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

    // Write config
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

    // Create auth directory
    if (!existsSync('auth')) {
      mkdirSync('auth');
    }

    // Done!
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
      console.log(c('dim', '    3. Scan the QR code with WhatsApp'));
      console.log(c('dim', '       (Settings → Linked Devices → Link a Device)\n'));
    }

    // Ask to set up a service
    const setupServiceNow = await ask(rl, 'Set up a service now? (Y/n):', 'Y');
    if (setupServiceNow.toLowerCase() !== 'n') {
      console.log();
      await serviceAdd({ config: fullPath }, rl);
    }

    // Ask to start now
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

async function startCommand(configPath: string, opts: { tunnel?: boolean; publicUrl?: string } = {}) {
  banner();

  console.log(c('dim', `  Loading config from ${configPath}\n`));

  let config;
  try {
    config = loadConfig(configPath);
  } catch (err: any) {
    console.error(c('yellow', `  ❌ Failed to load config: ${err.message}`));
    process.exit(1);
  }

  // Apply CLI tunnel overrides
  if (opts.tunnel) {
    config.tunnel = { ...config.tunnel, provider: 'cloudflared' };
  }
  if (opts.publicUrl) {
    config.tunnel = { ...config.tunnel, public_url: opts.publicUrl };
  }

  const channelCount = Object.keys(config.channels).length;
  const serviceCount = Object.keys(config.services || {}).length;
  const routeCount = (config.routes || []).length;
  const totalBindings = serviceCount + routeCount;
  console.log(c('dim', `  ${channelCount} channel(s), ${totalBindings} service(s) configured\n`));

  const port = config.apiPort || 4000;

  if (config.tunnel) {
    if (config.tunnel.public_url) {
      console.log(c('magenta', `  📡 Using public URL: ${config.tunnel.public_url}\n`));
    } else if (config.tunnel.provider === 'cloudflared') {
      console.log(c('blue', `  💡 Your API port is ${port}. Point your tunnel to http://localhost:${port}\n`));
    }
  }

  const kit = new ChannelKit(config);

  process.on('SIGINT', () => {
    console.log(c('yellow', '\n  Shutting down...'));
    kit.stop().finally(() => {
      console.log(c('green', '  Done. Bye! 👋\n'));
      process.exit(0);
    });
    // Force exit after 3 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.log(c('dim', '  Force exit.'));
      process.exit(0);
    }, 3000);
  });

  await kit.start();
  
  console.log();
  console.log(c('green', '  🚀 ChannelKit is running!\n'));
  console.log(c('dim', '  Press Ctrl+C to stop\n'));

  const serviceWebhooks = Object.values(config.services || {}).map((s: any) => s.webhook);
  const routeWebhooks = (config.routes || []).map((r: any) => r.webhook);
  const webhooks = new Set([...serviceWebhooks, ...routeWebhooks].filter(Boolean));
  console.log(c('dim', '  Do not forget to run the server at:'));
  webhooks.forEach((wh) => {
    console.log(c('cyan', `    ${wh}`));
  });
  console.log(c('dim', '  For example you can run the demo server: node echo-server.js\n'));
}

// CLI setup
const program = new Command();

program
  .name('channelkit')
  .description('Messaging ingress for your app')
  .version('0.1.0');

program
  .command('init')
  .description('Set up ChannelKit interactively')
  .action(async () => {
    try {
      await initCommand();
    } catch (err: any) {
      console.error(c('yellow', `\n  ❌ ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start ChannelKit')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .option('--tunnel', 'Start a cloudflared tunnel automatically')
  .option('--public-url <url>', 'Use a manual public URL')
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    await startCommand(configPath, { tunnel: opts.tunnel, publicUrl: opts.publicUrl });
  });

// Service management commands
const service = program
  .command('service')
  .description('Manage onboarding services');

service
  .command('add')
  .description('Add a new service interactively')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(serviceAdd);

async function serviceAdd(opts = { config: 'config.yaml' }, rl : ReturnType<typeof createInterface> | undefined) {
  const configPath = resolve(opts.config);
  if (!existsSync(configPath)) {
    console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n  Run 'channelkit init' first.\n`));
    process.exit(1);
  }

  const { loadConfig, saveConfig } = await import('./config/parser');
  const config = loadConfig(configPath);

  const closeRl = !rl;
  if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(c('cyan', '\n  📦 Add a new service\n'));

    const name = await ask(rl, 'Service name:', 'Onkosto');
    if (!name) { if (closeRl) rl!.close(); return; }

    // Select channel
    const channelNames = Object.keys(config.channels);
    if (channelNames.length === 0) {
      console.log(c('yellow', '\n  ⚠️  No channels configured. Run `channelkit init` first.\n'));
      if (closeRl) rl!.close();
      return;
    }

    let selectedChannel: string;
    if (channelNames.length === 1) {
      selectedChannel = channelNames[0];
      const chType = (config.channels[selectedChannel] as any).type;
      console.log(c('dim', `\n  Channel: ${selectedChannel} (${chType})`));
    } else {
      const options = channelNames.map(ch => {
        const cfg = config.channels[ch] as any;
        const icon = cfg.type === 'whatsapp' ? '📱' : cfg.type === 'telegram' ? '💬' : '📧';
        return `${icon} ${ch} (${cfg.type})`;
      });
      const chIdx = await select(rl, 'Which channel?', options);
      selectedChannel = channelNames[chIdx];
    }

    const webhook = await ask(rl, 'Webhook URL:', 'http://localhost:3000');

    // Check if this channel already has other services (→ multi-service mode)
    if (!config.services) config.services = {};
    const existingOnChannel = Object.values(config.services).filter(s => s.channel === selectedChannel);
    const chType = (config.channels[selectedChannel] as any).type;
    
    let code: string | undefined;
    let command: string | undefined;

    if (existingOnChannel.length > 0) {
      if (chType === 'telegram') {
        // Telegram multi-service → slash commands
        console.log(c('dim', `\n  This channel already has ${existingOnChannel.length} service(s) → slash command mode`));
        const suggestedCmd = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        command = await ask(rl, 'Slash command (without /):', suggestedCmd);
        
        // Also add commands to existing services if they don't have one
        for (const [svcName, svc] of Object.entries(config.services)) {
          if (svc.channel === selectedChannel && !svc.command) {
            const existingCmd = svcName.toLowerCase().replace(/[^a-z0-9]/g, '');
            console.log(c('yellow', `\n  ⚠️  Existing service "${svcName}" needs a slash command too`));
            svc.command = await ask(rl, `Slash command for "${svcName}" (without /):`, existingCmd);
          }
        }
      } else {
        // WhatsApp multi-service → magic codes + groups
        console.log(c('dim', `\n  This channel already has ${existingOnChannel.length} service(s) → groups mode`));
        const suggestedCode = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
        code = await ask(rl, 'Magic code for onboarding:', suggestedCode);
        
        // Also add codes to existing services if they don't have one
        for (const [svcName, svc] of Object.entries(config.services)) {
          if (svc.channel === selectedChannel && !svc.code) {
            const existingCode = svcName.toUpperCase().replace(/[^A-Z0-9]/g, '');
            console.log(c('yellow', `\n  ⚠️  Existing service "${svcName}" needs a magic code too (for groups mode)`));
            svc.code = await ask(rl, `Magic code for "${svcName}":`, existingCode);
          }
        }
      }
    }

    // STT/TTS configuration
    let stt: any = undefined;
    let tts: any = undefined;

    const enableStt = await ask(rl, 'Enable speech-to-text for voice messages? (y/N):', 'N');
    if (enableStt.toLowerCase() === 'y') {
      const sttProviderIdx = await select(rl, 'STT provider:', [
        '🔵 Google Cloud Speech-to-Text',
        '🟢 OpenAI Whisper',
        '🟣 Deepgram',
      ]);
      const sttProvider = ['google', 'whisper', 'deepgram'][sttProviderIdx];
      const sttLanguage = await ask(rl, 'Primary language (e.g. en-US, he-IL):', 'en-US');
      stt = { provider: sttProvider, language: sttLanguage };
      console.log(c('dim', `\n  💡 Set ${sttProvider.toUpperCase()}_API_KEY env var before starting.\n`));
    }

    const enableTts = await ask(rl, 'Enable text-to-speech for responses? (y/N):', 'N');
    if (enableTts.toLowerCase() === 'y') {
      const ttsProviderIdx = await select(rl, 'TTS provider:', [
        '🔵 Google Cloud Text-to-Speech',
        '🟡 ElevenLabs',
        '🟢 OpenAI TTS',
      ]);
      const ttsProvider = ['google', 'elevenlabs', 'openai'][ttsProviderIdx];
      const ttsVoice = await ask(rl, 'Voice ID (optional, press Enter to skip):');
      tts = { provider: ttsProvider, ...(ttsVoice ? { voice: ttsVoice } : {}) };
      console.log(c('dim', `\n  💡 Set ${ttsProvider.toUpperCase()}_API_KEY env var before starting.\n`));
    }

    // Check for duplicate name
    if (config.services[name]) {
      console.log(c('yellow', `\n  ⚠️  Service "${name}" already exists.\n`));
      if (closeRl) rl!.close();
      return;
    }

    config.services[name] = {
      channel: selectedChannel,
      webhook,
      ...(code ? { code: code.toUpperCase() } : {}),
      ...(command ? { command: command.toLowerCase().replace(/^\//, '') } : {}),
      ...(stt ? { stt } : {}),
      ...(tts ? { tts } : {}),
    };
    saveConfig(configPath, config);

    // Show result
    const chCfg = config.channels[selectedChannel] as any;
    const number = chCfg?.number?.replace(/[^0-9]/g, '') || '';

    console.log(c('green', `\n  ✅ Service "${name}" added!\n`));
    console.log(c('dim', `  Channel: ${selectedChannel} (${chCfg.type})`));
    console.log(c('dim', `  Webhook: ${webhook}`));
    if (code) {
      console.log(c('dim', `  Code:    ${code.toUpperCase()}`));
      if (chCfg.type === 'whatsapp' && number) {
        console.log(c('cyan', `\n  📱 Share: https://wa.me/${number}?text=${encodeURIComponent(code.toUpperCase())}`));
      }
    }
    if (command) {
      console.log(c('dim', `  Command: /${command}`));
    }
    console.log();
  } finally {
    if (closeRl) rl!.close();
  }
}

service
  .command('list')
  .description('List all configured services')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n`));
      process.exit(1);
    }

    const { loadConfig } = await import('./config/parser');
    const config = loadConfig(configPath);
    const svcs = config.services || {};

    if (Object.keys(svcs).length === 0) {
      console.log(c('dim', '\n  No services configured. Run `channelkit service add` to add one.\n'));
      return;
    }

    console.log(c('cyan', '\n  📦 Configured Services\n'));
    for (const [name, svc] of Object.entries(svcs)) {
      const chCfg = config.channels[svc.channel] as any;
      const icon = chCfg?.type === 'whatsapp' ? '📱' : chCfg?.type === 'telegram' ? '💬' : '📧';
      const mode = Object.values(svcs).filter(s => s.channel === svc.channel).length > 1 ? 'groups' : 'direct';
      console.log(c('bright', `  ${icon} ${name}`));
      console.log(c('dim', `    Channel: ${svc.channel} (${chCfg?.type || '?'})`));
      console.log(c('dim', `    Webhook: ${svc.webhook}`));
      console.log(c('dim', `    Mode:    ${mode}`));
      if (svc.code) {
        console.log(c('dim', `    Code:    ${svc.code}`));
        const number = chCfg?.number?.replace(/[^0-9]/g, '') || '';
        if (number) {
          console.log(c('dim', `    Share:   https://wa.me/${number}?text=${encodeURIComponent(svc.code)}`));
        }
      }
      console.log();
    }
  });

service
  .command('remove <name>')
  .description('Remove a service by name')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (name, opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n`));
      process.exit(1);
    }

    const { loadConfig, saveConfig } = await import('./config/parser');
    const config = loadConfig(configPath);

    if (!config.services || !config.services[name]) {
      console.error(c('yellow', `\n  ❌ Service "${name}" not found.\n`));
      const available = Object.keys(config.services || {}).join(', ');
      if (available) console.log(c('dim', `  Available: ${available}\n`));
      process.exit(1);
    }

    const removed = config.services[name];
    delete config.services[name];
    saveConfig(configPath, config);

    console.log(c('green', `\n  ✅ Removed service "${name}" (channel: ${removed.channel})\n`));
  });

// Channel management commands
const channel = program
  .command('channel')
  .description('Manage channels');

channel
  .command('list')
  .description('List all configured channels')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n  Run 'channelkit init' first.\n`));
      process.exit(1);
    }

    const { loadConfig } = await import('./config/parser');
    const config = loadConfig(configPath);

    const channels = Object.entries(config.channels);
    if (channels.length === 0) {
      console.log(c('dim', '\n  No channels configured. Run `channelkit channel add` to add one.\n'));
      return;
    }

    console.log(c('cyan', '\n  📡 Configured Channels\n'));
    for (const [name, cfg] of channels) {
      const chCfg = cfg as any;
      const icon = chCfg.type === 'whatsapp' ? '📱' : chCfg.type === 'telegram' ? '💬' : chCfg.type === 'email' ? '📧' : '📡';
      console.log(c('bright', `  ${icon} ${name}`));
      console.log(c('dim', `    Type: ${chCfg.type}`));
      if (chCfg.number) console.log(c('dim', `    Number: ${chCfg.number}`));
      if (chCfg.mode) console.log(c('dim', `    Mode: ${chCfg.mode}`));
      if (chCfg.bot_token) console.log(c('dim', `    Token: ${chCfg.bot_token.slice(0, 8)}...`));
      if (chCfg.address) console.log(c('dim', `    Address: ${chCfg.address}`));

      // Count services for this channel
      const svcCount = Object.values(config.services || {}).filter(s => s.channel === name).length
        + (config.routes || []).filter(r => r.channel === name).length;
      console.log(c('dim', `    Services: ${svcCount}`));
      console.log();
    }
  });

channel
  .command('add')
  .description('Add a new channel interactively')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n  Run 'channelkit init' first.\n`));
      process.exit(1);
    }

    const { loadConfig, saveConfig } = await import('./config/parser');
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
        // WhatsApp
        // Check if already exists
        const existingWa = Object.entries(config.channels).find(([, v]) => (v as any).type === 'whatsapp');
        if (existingWa) {
          const overwrite = await ask(rl, `WhatsApp channel "${existingWa[0]}" already exists. Replace? (y/N):`, 'N');
          if (overwrite.toLowerCase() !== 'y') { rl.close(); return; }
          // Remove old channel and its routes
          delete config.channels[existingWa[0]];
          if (config.services) { for (const [k, v] of Object.entries(config.services)) { if (v.channel === existingWa[0]) delete config.services[k]; } }
          config.routes = (config.routes || []).filter(r => r.channel !== existingWa[0]);
        }

        console.log();
        const number = await ask(rl, 'Your WhatsApp phone number (with country code):', '+972...');
        const modeIdx = await select(rl, 'How will you use this channel?', [
          '👤 Personal — route messages from groups on your number',
          '🏢 Service — dedicated number, every incoming message routed',
        ]);

        channelName = 'whatsapp';
        channelConfig = {
          type: 'whatsapp',
          number,
          mode: modeIdx === 0 ? 'groups' : 'direct',
        };

      } else if (channelIdx === 1) {
        // Telegram
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

        // Verify token
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
        channelConfig = {
          type: 'telegram',
          bot_token: token,
        };

      } else if (channelIdx === 2) {
        // Email
        console.log();
        const providerIdx = await select(rl, 'Which email provider?', [
          '📧 Gmail — OAuth2, polling (no public URL needed)',
          '📨 Resend — API + inbound webhooks (needs public URL)',
        ]);

        if (providerIdx === 0) {
          // Gmail
          console.log(c('bright', '\n  📝 Gmail OAuth Setup:\n'));
          console.log(c('dim', '  You need a Google Cloud project with Gmail API enabled.'));
          console.log(c('dim', '  Create OAuth2 credentials (Desktop app) at:'));
          console.log(c('cyan', '  https://console.cloud.google.com/apis/credentials\n'));

          const clientId = await ask(rl, 'OAuth Client ID:');
          const clientSecret = await ask(rl, 'OAuth Client Secret:');
          const pollInterval = await ask(rl, 'Poll interval (seconds):', '30');

          channelName = await ask(rl, 'Channel name:', 'gmail');
          channelConfig = {
            type: 'email',
            provider: 'gmail',
            client_id: clientId,
            client_secret: clientSecret,
            poll_interval: parseInt(pollInterval) || 30,
          };
        } else {
          // Resend
          console.log(c('bright', '\n  📝 Resend Setup:\n'));
          console.log(c('dim', '  You need a Resend account with a verified domain.'));
          console.log(c('dim', '  Get your API key at: https://resend.com/api-keys\n'));

          const apiKey = await ask(rl, 'Resend API Key:');
          const fromEmail = await ask(rl, 'Sender email (verified domain):', 'noreply@yourdomain.com');

          channelName = await ask(rl, 'Channel name:', 'resend');
          channelConfig = {
            type: 'email',
            provider: 'resend',
            api_key: apiKey,
            from_email: fromEmail,
          };

          console.log(c('dim', `\n  📬 Configure Resend inbound webhook to:`));
          console.log(c('cyan', `     <your-public-url>/inbound/resend/${channelName}\n`));
        }

      } else if (channelIdx === 3) {
        // SMS (Twilio)
        console.log(c('bright', '\n  📝 Twilio SMS Setup:\n'));
        console.log(c('dim', '  You need a Twilio account with a phone number.'));
        console.log(c('dim', '  Get credentials at: https://console.twilio.com\n'));

        const accountSid = await ask(rl, 'Account SID:');
        const authToken = await ask(rl, 'Auth Token:');
        const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');
        const pollInterval = await ask(rl, 'Poll interval in seconds (0 = webhook mode):', '10');

        channelName = await ask(rl, 'Channel name:', 'sms');
        channelConfig = {
          type: 'sms',
          provider: 'twilio',
          account_sid: accountSid,
          auth_token: authToken,
          number,
          ...(parseInt(pollInterval) > 0 ? { poll_interval: parseInt(pollInterval) } : {}),
        };

      } else if (channelIdx === 4) {
        // Voice (Twilio)
        console.log(c('bright', '\n  📝 Twilio Voice Setup:\n'));

        const accountSid = await ask(rl, 'Account SID:');
        const authToken = await ask(rl, 'Auth Token:');
        const number = await ask(rl, 'Twilio phone number (e.g. +12025551234):');

        channelName = await ask(rl, 'Channel name:', 'voice');
        channelConfig = {
          type: 'voice',
          provider: 'twilio',
          account_sid: accountSid,
          auth_token: authToken,
          number,
        };

        console.log(c('yellow', '\n  ⚠️  Voice requires a public URL. Use --tunnel or --public-url when starting.\n'));
      }

      config.channels[channelName] = channelConfig;
      saveConfig(configPath, config);

      console.log(c('green', `\n  ✅ Channel "${channelName}" added!\n`));

      if (channelName === 'whatsapp') {
        console.log(c('dim', '  Start ChannelKit and scan the QR code to connect WhatsApp.\n'));
      } else if (channelName === 'telegram') {
        console.log(c('dim', '  Start ChannelKit to activate the Telegram bot.\n'));
      }

      // Ask about service setup
      const modeOptions = [
        '📦 Single service — one webhook for all messages',
        '📦 Multiple services — route to different webhooks (WhatsApp: magic codes, Telegram: slash commands)',
      ];
      const modeIdx = await select(rl, 'How will this channel be used?', modeOptions);

      if (modeIdx === 0) {
        // Single service — ask webhook and create it
        const webhook = await ask(rl, 'Webhook URL:', 'http://localhost:3000');
        if (!config.services) config.services = {};
        const svcName = channelName;
        config.services[svcName] = { channel: channelName, webhook };
        saveConfig(configPath, config);
        console.log(c('green', `\n  ✅ Service "${svcName}" created → ${webhook}\n`));
      } else {
        // Multiple services — tell user to add services
        console.log(c('dim', '\n  Run `channelkit service add` to add services to this channel.\n'));
      }
    } finally {
      rl.close();
    }
  });

channel
  .command('remove <name>')
  .description('Remove a channel by name')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (name, opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n`));
      process.exit(1);
    }

    const { loadConfig, saveConfig } = await import('./config/parser');
    const config = loadConfig(configPath);

    if (!config.channels[name]) {
      console.error(c('yellow', `\n  ❌ Channel "${name}" not found.\n`));
      const available = Object.keys(config.channels).join(', ');
      if (available) console.log(c('dim', `  Available channels: ${available}\n`));
      process.exit(1);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      // Check for services that use this channel
      const affectedServices = Object.entries(config.services || {}).filter(([, v]) => v.channel === name);
      const affectedRoutes = (config.routes || []).filter(r => r.channel === name);
      const totalAffected = affectedServices.length + affectedRoutes.length;
      if (totalAffected > 0) {
        console.log(c('yellow', `\n  ⚠️  ${totalAffected} service(s) use this channel and will be removed too.`));
      }

      const confirm = await ask(rl, `Remove channel "${name}"? (y/N):`, 'N');
      if (confirm.toLowerCase() !== 'y') {
        console.log(c('dim', '\n  Cancelled.\n'));
        rl.close();
        return;
      }

      delete config.channels[name];
      if (config.services) { for (const [k, v] of Object.entries(config.services)) { if (v.channel === name) delete config.services[k]; } }
      config.routes = (config.routes || []).filter(r => r.channel !== name);
      saveConfig(configPath, config);

      console.log(c('green', `\n  ✅ Removed channel "${name}" and ${totalAffected} associated service(s).\n`));
    } finally {
      rl.close();
    }
  });

// Provision command
const provision = program
  .command('provision')
  .description('Provision a new phone number for WhatsApp');

provision
  .command('whatsapp')
  .description('Buy a number and register it with WhatsApp')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (opts) => {
    banner();
    console.log(c('bright', '  📱 Provision a WhatsApp number\n'));

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      // Get Twilio credentials
      console.log(c('dim', '  We\'ll use Twilio to buy a number and receive the WhatsApp\n  verification SMS automatically.\n'));
      console.log(c('dim', '  Don\'t have a Twilio account? Sign up at https://twilio.com\n'));

      const accountSid = await ask(rl, 'Twilio Account SID:');
      const authToken = await ask(rl, 'Twilio Auth Token:');

      if (!accountSid || !authToken) {
        console.log(c('yellow', '\n  ❌ Account SID and Auth Token are required.\n'));
        rl.close();
        return;
      }

      console.log(c('dim', '\n  Connecting to Twilio...'));

      const { TwilioProvisioner } = await import('./provisioning/twilio');
      const twilio = new TwilioProvisioner({ accountSid, authToken });

      // Choose country
      const country = await ask(rl, 'Country code (e.g. US, GB, IL):', 'US');

      // Search for numbers
      console.log(c('dim', `\n  Searching for mobile numbers in ${country}...\n`));

      let numbers;
      try {
        numbers = await twilio.searchNumbers(country, { type: 'mobile', limit: 5 });
      } catch (err: any) {
        // Fallback to local if mobile not available
        console.log(c('dim', '  No mobile numbers found, trying local numbers...\n'));
        numbers = await twilio.searchNumbers(country, { type: 'local', limit: 5 });
      }

      if (numbers.length === 0) {
        console.log(c('yellow', '  ❌ No numbers available in this country.\n'));
        rl.close();
        return;
      }

      // Display options
      const idx = await select(rl, 'Choose a number:', numbers.map(n => {
        const features = [
          n.capabilities.sms ? 'SMS' : '',
          n.capabilities.voice ? 'Voice' : '',
        ].filter(Boolean).join(', ');
        return `${n.phoneNumber}  ${c('dim', `(${n.locality || n.region || n.isoCountry}) [${features}]`)}`;
      }));

      const chosen = numbers[idx];
      console.log(c('dim', `\n  Purchasing ${chosen.phoneNumber}...`));

      // Purchase
      const purchased = await twilio.purchaseNumber(chosen.phoneNumber);
      console.log(c('green', `  ✅ Purchased: ${purchased.phoneNumber}\n`));

      // Save to config
      const configPath = resolve(opts.config);
      if (existsSync(configPath)) {
        const { loadConfig, saveConfig } = await import('./config/parser');
        const config = loadConfig(configPath);

        // Update or add WhatsApp channel
        const waKey = Object.keys(config.channels).find(k => (config.channels[k] as any).type === 'whatsapp') || 'whatsapp';
        config.channels[waKey] = {
          type: 'whatsapp',
          number: purchased.phoneNumber,
        };

        // Save Twilio config for future use
        (config as any).providers = (config as any).providers || {};
        (config as any).providers.twilio = {
          accountSid,
          numberSid: purchased.sid,
        };

        saveConfig(configPath, config);
        console.log(c('dim', `  Updated ${configPath} with new number.\n`));
      }

      // Step 2: Register number with WhatsApp
      console.log(c('bright', '\n  📲 Step 2: Register with WhatsApp\n'));
      console.log(c('white', '  Now add this number as a second account on your WhatsApp:\n'));
      console.log(c('dim', '  1. Open WhatsApp on your phone'));
      console.log(c('dim', '  2. Go to Settings → Add Account (or switch accounts)'));
      console.log(c('dim', `  3. Enter the new number: ${c('cyan', purchased.phoneNumber)}`));
      console.log(c('dim', '  4. WhatsApp will send an SMS to verify the number'));
      console.log(c('dim', '  5. We\'ll catch the SMS automatically via Twilio!\n'));

      const ready = await ask(rl, 'Ready? Press Enter when you\'ve requested the SMS verification in WhatsApp...');

      // Start polling for SMS
      console.log(c('dim', '\n  ⏳ Waiting for WhatsApp verification SMS...'));
      
      let dots = 0;
      const code = await twilio.waitForSms(purchased.phoneNumber, 120000, () => {
        dots = (dots + 1) % 4;
        process.stdout.write(`\r  ⏳ Waiting for SMS${'·'.repeat(dots)}${' '.repeat(3 - dots)}  `);
      });

      console.log(`\r                                        `);
      console.log(c('green', `\n  ╔═══════════════════════════════════════╗`));
      console.log(c('green', `  ║                                       ║`));
      console.log(c('green', `  ║   📬 Verification code: ${c('bright', code)}        ║`));
      console.log(c('green', `  ║                                       ║`));
      console.log(c('green', `  ╚═══════════════════════════════════════╝`));
      console.log(c('white', `\n  Enter this code in WhatsApp to complete registration.\n`));

      await ask(rl, 'Press Enter once WhatsApp is set up on the new number...');

      // Step 3: Connect CK as linked device
      console.log(c('bright', '\n  🔗 Step 3: Connect ChannelKit\n'));
      console.log(c('dim', '  Now we\'ll connect ChannelKit as a linked device...\n'));

      const { useMultiFileAuthState, makeCacheableSignalKeyStore } = await import('@whiskeysockets/baileys');
      const makeWASocket = (await import('@whiskeysockets/baileys')).default;
      const { join } = await import('path');
      const { mkdirSync, existsSync: dirExists } = await import('fs');

      const authDir = join('.', 'auth', `whatsapp-provisioned`);
      if (!dirExists(authDir)) mkdirSync(authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const phoneForPairing = purchased.phoneNumber.replace(/[^0-9]/g, '');

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
        },
      });

      sock.ev.on('creds.update', saveCreds);

      await new Promise<void>((resolveConn, rejectConn) => {
        let pairingRequested = false;
        const timeout = setTimeout(() => {
          sock.end(undefined);
          rejectConn(new Error('Connection timeout'));
        }, 120000);

        sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;

          if ((connection === 'connecting' || qr) && !pairingRequested) {
            pairingRequested = true;
            try {
              const pairingCode = await sock.requestPairingCode(phoneForPairing);
              const formatted = pairingCode.match(/.{1,4}/g)?.join('-') || pairingCode;

              console.log(c('green', '  ╔═══════════════════════════════════════╗'));
              console.log(c('green', '  ║                                       ║'));
              console.log(c('green', `  ║   Pairing code: ${c('bright', formatted)}          ║`));
              console.log(c('green', '  ║                                       ║'));
              console.log(c('green', '  ╚═══════════════════════════════════════╝'));
              console.log();
              console.log(c('white', '  On your phone:'));
              console.log(c('dim', `  1. Switch to the ${purchased.phoneNumber} account in WhatsApp`));
              console.log(c('dim', '  2. Go to Settings → Linked Devices → Link a Device'));
              console.log(c('dim', '  3. Tap "Link with phone number instead"'));
              console.log(c('dim', `  4. Enter: ${purchased.phoneNumber}`));
              console.log(c('dim', `  5. Enter the pairing code: ${formatted}`));
              console.log(c('dim', '\n  Waiting for pairing...\n'));
            } catch (err: any) {
              clearTimeout(timeout);
              sock.end(undefined);
              rejectConn(new Error(`Failed to request pairing code: ${err.message}`));
            }
          }

          if (connection === 'open') {
            clearTimeout(timeout);
            sock.end(undefined);
            resolveConn();
          }

          if (connection === 'close') {
            const reason = (lastDisconnect?.error as any)?.output?.statusCode;
            if (reason === 515) {
              clearTimeout(timeout);
              sock.end(undefined);
              resolveConn();
            }
          }
        });
      });

      // Done!
      console.log(c('green', '  ╔═══════════════════════════════════════════╗'));
      console.log(c('green', '  ║                                           ║'));
      console.log(c('green', '  ║   🎉 Provisioning complete!               ║'));
      console.log(c('green', '  ║                                           ║'));
      console.log(c('green', `  ║   Number: ${purchased.phoneNumber.padEnd(28)}║`));
      console.log(c('green', '  ║   WhatsApp: Connected ✅                  ║'));
      console.log(c('green', '  ║                                           ║'));
      console.log(c('green', '  ╚═══════════════════════════════════════════╝'));
      console.log();
      console.log(c('white', '  Start ChannelKit:\n'));
      console.log(c('cyan', '    npm start\n'));

    } catch (err: any) {
      console.error(c('yellow', `\n  ❌ ${err.message}\n`));
    } finally {
      rl.close();
    }
  });

program.parse();
