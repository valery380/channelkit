import { loadConfig, saveConfig } from '../../config/parser';
import { ServerContext } from '../types';

export interface CreateServiceInput {
  name?: string;
  channel?: string;
  webhook?: string;
  code?: string;
  command?: string;
  allow_list?: string[];
  method?: string;
  auth?: { type?: string; [k: string]: any };
  description?: string;
}

export interface CreateServiceResult {
  status: number;
  body: any;
}

/** Validate a channel/service name: only alphanumeric, hyphens, and underscores allowed. */
function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Create a new service in the config file and hot-reload the router.
 * Shared by the admin route (POST /api/config/services) and the scoped
 * provisioning route (POST /api/provision/services).
 */
export function createService(ctx: ServerContext, input: CreateServiceInput): CreateServiceResult {
  if (!ctx.configPath) return { status: 503, body: { error: 'Config path not set' } };

  const { name, channel, webhook, code, command, allow_list, method, auth, description } = input;
  if (!name || !channel || !webhook) {
    return { status: 400, body: { error: 'name, channel, and webhook are required' } };
  }
  if (!isValidName(name)) {
    return { status: 400, body: { error: 'Name must contain only letters, numbers, hyphens, and underscores' } };
  }
  const validMethods = ['POST', 'GET', 'PUT', 'PATCH'];
  if (method && !validMethods.includes(method.toUpperCase())) {
    return { status: 400, body: { error: `Invalid method. Must be one of: ${validMethods.join(', ')}` } };
  }
  if (auth && !['bearer', 'header'].includes(auth.type as string)) {
    return { status: 400, body: { error: 'Invalid auth type. Must be "bearer" or "header"' } };
  }

  try {
    const config = loadConfig(ctx.configPath, { validate: false });
    if (!config.services) config.services = {};
    if (config.services[name]) {
      return { status: 409, body: { error: `Service "${name}" already exists` } };
    }
    if (!config.channels[channel]) {
      return { status: 400, body: { error: `Channel "${channel}" does not exist` } };
    }
    const methodUpper = method ? method.toUpperCase() : undefined;
    config.services[name] = {
      channel, webhook,
      ...(methodUpper && methodUpper !== 'POST' && { method: methodUpper as any }),
      ...(auth?.type && { auth: auth as any }),
      ...(code && { code }),
      ...(command && { command }),
      ...(Array.isArray(allow_list) && allow_list.length > 0 && { allow_list }),
      ...(description && { description }),
    };
    saveConfig(ctx.configPath, config);
    ctx.reloadRouter?.();
    ctx.broadcast({ type: 'configChanged' });
    return { status: 200, body: { ok: true } };
  } catch (err: any) {
    console.error('[createService]', err);
    return { status: 500, body: { error: 'Internal server error' } };
  }
}
