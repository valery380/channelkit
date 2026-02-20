import { readFileSync, writeFileSync } from 'fs';
import { parse, stringify } from 'yaml';
import { AppConfig } from './types';

export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, 'utf-8');
  const config = parse(raw) as AppConfig;

  if (!config.channels || Object.keys(config.channels).length === 0) {
    throw new Error('Config must define at least one channel');
  }
  if (!config.routes || config.routes.length === 0) {
    throw new Error('Config must define at least one route');
  }

  return config;
}

export function saveConfig(path: string, config: AppConfig): void {
  const yaml = stringify(config, { lineWidth: 0 });
  writeFileSync(path, `# ChannelKit Configuration\n\n${yaml}`);
}
