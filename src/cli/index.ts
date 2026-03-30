#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { c, ask } from './helpers';
import { DEFAULT_CONFIG_PATH } from '../paths';
import { initCommand } from './commands/init';
import { startCommand } from './commands/start';
import { sendCommand } from './commands/send';
import { demoCommand } from './commands/demo';
import { serviceAddWizard } from './wizards/service';
import { channelAddWizard } from './wizards/channel';
import { provisionWhatsAppWizard } from './wizards/provision';
import { installSkillCommand } from './commands/install-skill';
import { installServiceCommand, uninstallServiceCommand, serviceStatusCommand, serviceStopCommand, serviceStartCommand } from './commands/service-install';

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
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
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
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action((opts) => serviceAddWizard(opts));

service
  .command('list')
  .description('List all configured services')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n`));
      process.exit(1);
    }

    const { loadConfig } = await import('../config/parser');
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
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action(async (name, opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n`));
      process.exit(1);
    }

    const { loadConfig, saveConfig } = await import('../config/parser');
    const config = loadConfig(configPath);

    if (!config.services || !config.services[name]) {
      console.error(c('yellow', `\n  ❌ Service "${name}" not found.\n`));
      const available = Object.keys(config.services || {}).join(', ');
      if (available) console.log(c('dim', `  Available: ${available}\n`));
      process.exit(1);
    }

    const removed = config.services[name];

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await ask(rl, `Remove service "${name}" (channel: ${removed.channel})? [y/N]`, 'N');
    rl.close();

    if (confirm.toLowerCase() !== 'y') {
      console.log(c('dim', '\n  Cancelled.\n'));
      process.exit(0);
    }

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
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n  Run 'channelkit init' first.\n`));
      process.exit(1);
    }

    const { loadConfig } = await import('../config/parser');
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
      const svcCount = Object.values(config.services || {}).filter(s => s.channel === name).length
        + (config.routes || []).filter(r => r.channel === name).length;
      console.log(c('dim', `    Services: ${svcCount}`));
      console.log();
    }
  });

channel
  .command('add')
  .description('Add a new channel interactively')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action((opts) => channelAddWizard(opts));

channel
  .command('remove <name>')
  .description('Remove a channel by name')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action(async (name, opts) => {
    const configPath = resolve(opts.config);
    if (!existsSync(configPath)) {
      console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n`));
      process.exit(1);
    }

    const { loadConfig, saveConfig } = await import('../config/parser');
    const config = loadConfig(configPath);

    if (!config.channels[name]) {
      console.error(c('yellow', `\n  ❌ Channel "${name}" not found.\n`));
      const available = Object.keys(config.channels).join(', ');
      if (available) console.log(c('dim', `  Available channels: ${available}\n`));
      process.exit(1);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
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

// System service management (install/uninstall/status/stop/restart)
const daemon = program
  .command('daemon')
  .description('Manage ChannelKit as a background service (auto-start on boot)');

daemon
  .command('install')
  .description('Install ChannelKit as a system service (starts on boot)')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action((opts) => installServiceCommand(resolve(opts.config)));

daemon
  .command('uninstall')
  .description('Remove the system service')
  .action(() => uninstallServiceCommand());

daemon
  .command('status')
  .description('Check if the service is running')
  .action(() => serviceStatusCommand());

daemon
  .command('stop')
  .description('Stop the service')
  .action(() => serviceStopCommand());

daemon
  .command('start')
  .description('Start the service')
  .action(() => serviceStartCommand());

// Provision command
const provision = program
  .command('provision')
  .description('Provision a new phone number for WhatsApp');

provision
  .command('whatsapp')
  .description('Buy a number and register it with WhatsApp')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action((opts) => provisionWhatsAppWizard(opts));

program
  .command('send <channel> <number> <message>')
  .description('Send a WhatsApp message to a phone number')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .option('-p, --port <port>', 'API server port', '4000')
  .action(sendCommand);

program
  .command('demo')
  .description('Run the built-in echo/demo server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(demoCommand);

program
  .command('install-skill')
  .description('Install the ChannelKit skill for Claude Code')
  .option('--print', 'Output the skill file to stdout instead of installing')
  .action(installSkillCommand);

// Export / Import commands
program
  .command('export [output-path]')
  .description('Export ChannelKit config, groups, and auth to a ZIP file')
  .action(async (outputPath?: string) => {
    const { execFileSync } = await import('child_process');
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const { CHANNELKIT_HOME, DEFAULT_CONFIG_PATH, DEFAULT_AUTH_DIR, DEFAULT_DATA_DIR } = await import('../paths');

    const date = new Date().toISOString().slice(0, 10);
    const dest = outputPath || `channelkit-backup-${date}.zip`;

    const relPaths: string[] = [];
    if (existsSync(DEFAULT_CONFIG_PATH)) relPaths.push('config.yaml');
    if (existsSync(join(DEFAULT_DATA_DIR, 'groups.json'))) relPaths.push(join('data', 'groups.json'));
    if (existsSync(DEFAULT_AUTH_DIR)) relPaths.push('auth');

    if (relPaths.length === 0) {
      console.error(c('yellow', '\n  ❌ No data found in ~/.channelkit to export.\n'));
      process.exit(1);
    }

    try {
      // Remove existing file to avoid appending
      if (existsSync(dest)) {
        const { unlinkSync } = await import('fs');
        unlinkSync(dest);
      }
      const absOut = resolve(dest);
      execFileSync('zip', ['-r', absOut, ...relPaths], { cwd: CHANNELKIT_HOME, stdio: 'pipe' });
      console.log(c('green', `\n  ✅ Exported to ${absOut}\n`));
      console.log(c('dim', `  Includes: ${relPaths.join(', ')}\n`));
    } catch (err: any) {
      console.error(c('yellow', `\n  ❌ Export failed: ${err.message}\n`));
      process.exit(1);
    }
  });

program
  .command('import <zip-path>')
  .description('Import ChannelKit data from a ZIP backup')
  .action(async (zipPath: string) => {
    const { execFileSync } = await import('child_process');
    const { existsSync, mkdirSync } = await import('fs');
    const { CHANNELKIT_HOME } = await import('../paths');

    const absZip = resolve(zipPath);
    if (!existsSync(absZip)) {
      console.error(c('yellow', `\n  ❌ File not found: ${absZip}\n`));
      process.exit(1);
    }

    console.log(c('yellow', '\n  ⚠️  This will overwrite existing config, groups, and auth data.'));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await ask(rl, '  Continue? [y/N]', 'N');
    rl.close();

    if (confirm.toLowerCase() !== 'y') {
      console.log(c('dim', '\n  Cancelled.\n'));
      process.exit(0);
    }

    try {
      if (!existsSync(CHANNELKIT_HOME)) mkdirSync(CHANNELKIT_HOME, { recursive: true });
      execFileSync('unzip', ['-o', absZip, '-d', CHANNELKIT_HOME], { stdio: 'pipe' });
      console.log(c('green', '\n  ✅ Import successful.\n'));
      console.log(c('dim', '  Restart ChannelKit for changes to take effect.\n'));
    } catch (err: any) {
      console.error(c('yellow', `\n  ❌ Import failed: ${err.message}\n`));
      process.exit(1);
    }
  });

// Default to "start" when no command is given
const args = process.argv.slice(2);
const knownCommands = program.commands.map(c => c.name());
if (args.length === 0 || (args.length > 0 && !knownCommands.includes(args[0]) && !args[0].startsWith('-'))) {
  // Inject "start" as the default command
  process.argv.splice(2, 0, 'start');
}

program.parse();
