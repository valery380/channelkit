#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from './config/parser';
import { ChannelKit } from './index';

const program = new Command();

program
  .name('channelkit')
  .description('Messaging gateway — connect chat channels to your app via webhooks')
  .version('0.1.0');

program
  .command('start')
  .description('Start ChannelKit with the given config')
  .option('-c, --config <path>', 'Path to config file', 'config.yaml')
  .action(async (opts) => {
    const configPath = resolve(opts.config);
    console.log(`Loading config from ${configPath}`);

    let config;
    try {
      config = loadConfig(configPath);
    } catch (err: any) {
      console.error(`❌ Failed to load config: ${err.message}`);
      process.exit(1);
    }

    const kit = new ChannelKit(config);

    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await kit.stop();
      process.exit(0);
    });

    await kit.start();
  });

program.parse();
