import { readFileSync, writeFileSync } from 'fs';
import { parse, stringify } from 'yaml';
import { AppConfig } from './types';

/** Optional hook called after every saveConfig. Used by remote store to sync. */
let onSaveHook: ((yaml: string) => void) | null = null;

export function setOnSaveHook(hook: ((yaml: string) => void) | null): void {
  onSaveHook = hook;
}

export function loadConfig(path: string, opts: { validate?: boolean } = {}): AppConfig {
  const raw = readFileSync(path, 'utf-8');
  const config = parse(raw) as AppConfig;

  const validate = opts.validate !== false;

  if (validate) {
    if (!config.channels || Object.keys(config.channels).length === 0) {
      throw new Error('Config must define at least one channel');
    }

    // Must have either services or routes
    const hasServices = config.services && Object.keys(config.services).length > 0;
    const hasRoutes = config.routes && config.routes.length > 0;
    const hasOnboarding = config.onboarding?.codes && config.onboarding.codes.length > 0;

    if (!hasServices && !hasRoutes && !hasOnboarding) {
      throw new Error('Config must define at least one service (or legacy route)');
    }

    // Validate service channel references
    if (config.services) {
      for (const [name, svc] of Object.entries(config.services)) {
        if (!config.channels[svc.channel]) {
          throw new Error(`Service "${name}" references unknown channel "${svc.channel}"`);
        }
      }
    }
  }

  return config;
}

export function saveConfig(path: string, config: AppConfig): void {
  const yaml = stringify(config, { lineWidth: 0 });
  const content = `# ChannelKit Configuration\n\n${yaml}`;
  writeFileSync(path, content);
  if (onSaveHook) onSaveHook(content);
}
