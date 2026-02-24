import { resolve } from 'path';
import { loadConfig } from '../../config/parser';
import { ChannelKit } from '../../index';
import { banner, c } from '../helpers';

export async function startCommand(configPath: string, opts: { tunnel?: boolean; publicUrl?: string } = {}) {
  banner();

  console.log(c('dim', `  Loading config from ${configPath}\n`));

  let config;
  try {
    config = loadConfig(configPath, { validate: false });
  } catch (err: any) {
    console.error(c('yellow', `  ❌ Failed to load config: ${err.message}`));
    process.exit(1);
  }
  if (!config.channels) config.channels = {};
  if (!config.services) config.services = {};

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

  const kit = new ChannelKit(config, configPath);

  process.on('SIGINT', () => {
    console.log(c('yellow', '\n  Shutting down...'));
    kit.stop().finally(() => {
      console.log(c('green', '  Done. Bye! 👋\n'));
      process.exit(0);
    });
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
