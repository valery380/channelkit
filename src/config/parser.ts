import { readFileSync } from 'fs';
import { parse } from 'yaml';
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
