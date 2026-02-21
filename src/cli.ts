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
      '📧 Email — connect IMAP/SMTP',
    ]);

    const channels: Record<string, any> = {};
    const routes: any[] = [];

    if (channelIdx === 0) {
      // WhatsApp
      console.log();
      const number = await ask(rl, 'Your WhatsApp phone number (with country code):', '+972...');
      
      const modeIdx = await select(rl, 'How will you use this channel?', [
        '👤 Personal — route messages from groups on your number',
        '🏢 Service — dedicated number, every incoming message routed',
      ]);

      channels['whatsapp'] = {
        type: 'whatsapp',
        number: number,
        mode: modeIdx === 0 ? 'groups' : 'direct',
      };

      routes.push({
        channel: 'whatsapp',
        match: '*',
        webhook: '',
      });

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

      channels['telegram'] = {
        type: 'telegram',
        bot_token: token,
      };

      routes.push({
        channel: 'telegram',
        match: '*',
        webhook: '',
      });

    } else {
      // Email
      console.log();
      const address = await ask(rl, 'Email address:', 'support@myapp.com');
      const imap = await ask(rl, 'IMAP server:', 'imap.gmail.com');

      channels['email'] = {
        type: 'email',
        address,
        imap,
      };

      routes.push({
        channel: 'email',
        match: '*',
        webhook: '',
      });
    }

    // Step 2: Webhook
    console.log();
    const webhook = await ask(rl, 'Where should messages be sent? (webhook URL):', 'http://localhost:3000/api/chat');
    routes.forEach(r => r.webhook = webhook);

    // Step 3: Generate config
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

    yaml += `\nroutes:\n`;
    for (const route of routes) {
      yaml += `  - channel: ${route.channel}\n`;
      yaml += `    match: "${route.match}"\n`;
      yaml += `    webhook: "${route.webhook}"\n`;
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
    console.log(c('dim', `    1. Make sure your webhook is running at ${webhook}`));
    console.log(c('dim', '    2. Start ChannelKit:\n'));
    console.log(c('cyan', '       npx channelkit start'));
    console.log();
    
    if (channels['whatsapp']) {
      console.log(c('dim', '    3. Scan the QR code with WhatsApp'));
      console.log(c('dim', '       (Settings → Linked Devices → Link a Device)\n'));
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

async function startCommand(configPath: string) {
  banner();

  console.log(c('dim', `  Loading config from ${configPath}\n`));

  let config;
  try {
    config = loadConfig(configPath);
  } catch (err: any) {
    console.error(c('yellow', `  ❌ Failed to load config: ${err.message}`));
    process.exit(1);
  }

  const channelCount = Object.keys(config.channels).length;
  const routeCount = config.routes.length;
  console.log(c('dim', `  ${channelCount} channel(s), ${routeCount} route(s) configured\n`));

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
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    await startCommand(configPath);
  });

// Service management commands
const service = program
  .command('service')
  .description('Manage onboarding services');

service
  .command('add')
  .description('Add a new service interactively')
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
      console.log(c('cyan', '\n  📦 Add a new service\n'));

      const name = await ask(rl, 'Service name:');
      if (!name) { rl.close(); return; }

      const suggestedCode = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const code = await ask(rl, 'Magic code:', suggestedCode);

      // Detect available channels
      const availableChannels: string[] = [];
      for (const ch of Object.values(config.channels)) {
        if ((ch as any).type === 'whatsapp') availableChannels.push('whatsapp');
        if ((ch as any).type === 'telegram') availableChannels.push('telegram');
      }

      let selectedChannels: string[] = [];
      if (availableChannels.length === 0) {
        console.log(c('yellow', '\n  ⚠️  No channels configured. Run `channelkit init` first.\n'));
        rl.close();
        return;
      } else if (availableChannels.length === 1) {
        selectedChannels = availableChannels;
        console.log(c('dim', `\n  Channel: ${availableChannels[0]}`));
      } else {
        const options = [
          ...availableChannels.map(ch => ch === 'whatsapp' ? '📱 WhatsApp' : '💬 Telegram'),
          '📱💬 Both',
        ];
        const chIdx = await select(rl, 'Which channel(s)?', options);
        if (chIdx === availableChannels.length) {
          selectedChannels = [...availableChannels]; // Both
        } else {
          selectedChannels = [availableChannels[chIdx]];
        }
      }

      const webhook = await ask(rl, 'Webhook URL:', 'http://localhost:3000/api/chat');

      if (!config.onboarding) config.onboarding = { codes: [] };
      if (!config.onboarding.codes) config.onboarding.codes = [];

      // Check for duplicate code
      const existing = config.onboarding.codes.find(c => c.code.toUpperCase() === code.toUpperCase());
      if (existing) {
        console.log(c('yellow', `\n  ⚠️  Code "${code}" already exists for service "${existing.name}"\n`));
        rl.close();
        return;
      }

      config.onboarding.codes.push({ 
        code: code.toUpperCase(), 
        name, 
        webhook,
        channels: selectedChannels.length === availableChannels.length ? undefined : selectedChannels,
      });
      saveConfig(configPath, config);

      // Show share links
      const waChannel = Object.values(config.channels).find((ch: any) => ch.type === 'whatsapp') as any;
      const number = waChannel?.number?.replace(/[^0-9]/g, '') || '';

      console.log(c('green', `\n  ✅ Service "${name}" added!\n`));
      console.log(c('dim', `  Code:     ${code.toUpperCase()}`));
      console.log(c('dim', `  Channels: ${selectedChannels.join(', ')}`));
      console.log(c('dim', `  Webhook:  ${webhook}`));
      if (selectedChannels.includes('whatsapp') && number) {
        console.log(c('cyan', `\n  📱 WhatsApp: https://wa.me/${number}?text=${encodeURIComponent(code.toUpperCase())}`));
      }
      if (selectedChannels.includes('telegram')) {
        const tgChannel = Object.values(config.channels).find((ch: any) => ch.type === 'telegram') as any;
        if (tgChannel?.bot_token) {
          // We'd need the bot username — for now show generic
          console.log(c('cyan', `  💬 Telegram: send "${code.toUpperCase()}" to your bot`));
        }
      }
      console.log();
    } finally {
      rl.close();
    }
  });

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
    const codes = config.onboarding?.codes || [];

    if (codes.length === 0) {
      console.log(c('dim', '\n  No services configured. Run `channelkit service add` to add one.\n'));
      return;
    }

    const waChannel = Object.values(config.channels).find((ch: any) => ch.type === 'whatsapp') as any;
    const number = waChannel?.number?.replace(/[^0-9]/g, '') || '';

    console.log(c('cyan', '\n  📦 Configured Services\n'));
    for (const svc of codes) {
      console.log(c('bright', `  ${svc.name}`));
      console.log(c('dim', `    Code:    ${svc.code}`));
      console.log(c('dim', `    Webhook: ${svc.webhook}`));
      if (number) {
        console.log(c('dim', `    Share:   https://wa.me/${number}?text=${encodeURIComponent(svc.code)}`));
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
    const codes = config.onboarding?.codes || [];

    const idx = codes.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
    if (idx === -1) {
      console.error(c('yellow', `\n  ❌ Service "${name}" not found.\n`));
      process.exit(1);
    }

    const removed = codes.splice(idx, 1)[0];
    if (!config.onboarding) config.onboarding = { codes: [] };
    config.onboarding.codes = codes;
    saveConfig(configPath, config);

    console.log(c('green', `\n  ✅ Removed service "${removed.name}" (code: ${removed.code})\n`));
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

      // Count routes for this channel
      const routeCount = config.routes.filter(r => r.channel === name).length;
      console.log(c('dim', `    Routes: ${routeCount}`));
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
        '📧 Email — connect IMAP/SMTP',
      ]);

      let channelName: string;
      let channelConfig: any;

      if (channelIdx === 0) {
        // WhatsApp
        // Check if already exists
        const existingWa = Object.entries(config.channels).find(([, v]) => (v as any).type === 'whatsapp');
        if (existingWa) {
          const overwrite = await ask(rl, `WhatsApp channel "${existingWa[0]}" already exists. Replace? (y/N):`, 'N');
          if (overwrite.toLowerCase() !== 'y') { rl.close(); return; }
          // Remove old channel and its routes
          delete config.channels[existingWa[0]];
          config.routes = config.routes.filter(r => r.channel !== existingWa[0]);
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
          config.routes = config.routes.filter(r => r.channel !== existingTg[0]);
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

      } else {
        // Email
        console.log();
        const address = await ask(rl, 'Email address:', 'support@myapp.com');
        const imap = await ask(rl, 'IMAP server:', 'imap.gmail.com');

        channelName = 'email';
        channelConfig = {
          type: 'email',
          address,
          imap,
        };
      }

      // Ask for default webhook route
      const addRoute = await ask(rl, 'Add a default route for this channel? (Y/n):', 'Y');
      if (addRoute.toLowerCase() !== 'n') {
        const webhook = await ask(rl, 'Webhook URL:', 'http://localhost:3000/api/chat');
        config.routes.push({
          channel: channelName,
          match: '*',
          webhook,
        });
      }

      config.channels[channelName] = channelConfig;
      saveConfig(configPath, config);

      console.log(c('green', `\n  ✅ Channel "${channelName}" added!\n`));

      if (channelName === 'whatsapp') {
        console.log(c('dim', '  Start ChannelKit and scan the QR code to connect WhatsApp.\n'));
      } else if (channelName === 'telegram') {
        console.log(c('dim', '  Start ChannelKit to activate the Telegram bot.\n'));
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
      // Check for routes that use this channel
      const affectedRoutes = config.routes.filter(r => r.channel === name);
      if (affectedRoutes.length > 0) {
        console.log(c('yellow', `\n  ⚠️  ${affectedRoutes.length} route(s) use this channel and will be removed too.`));
      }

      const confirm = await ask(rl, `Remove channel "${name}"? (y/N):`, 'N');
      if (confirm.toLowerCase() !== 'y') {
        console.log(c('dim', '\n  Cancelled.\n'));
        rl.close();
        return;
      }

      delete config.channels[name];
      config.routes = config.routes.filter(r => r.channel !== name);
      saveConfig(configPath, config);

      console.log(c('green', `\n  ✅ Removed channel "${name}" and ${affectedRoutes.length} associated route(s).\n`));
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
