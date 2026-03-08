import { Express } from 'express';
import { ServerContext } from '../types';
import { loadConfig, saveConfig } from '../../config/parser';
import { setAllowLocalWebhooks } from '../../core/webhook';

export function registerSettingsRoutes(app: Express, ctx: ServerContext): void {
  app.get('/api/settings', (_req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      const settings = config.settings || {};
      const masked: Record<string, any> = {};
      for (const [key, val] of Object.entries(settings)) {
        if (typeof val === 'boolean') {
          masked[key] = val;
        } else if (typeof val === 'string' && val.length > 0) {
          masked[key] = val.length > 4 ? '•'.repeat(val.length - 4) + val.slice(-4) : '••••';
        } else {
          masked[key] = '';
        }
      }
      // Include mcp_secret from mcp.secret
      const mcpSecret = config.mcp?.secret || '';
      if (mcpSecret) {
        masked['mcp_secret'] = mcpSecret.length > 4 ? '•'.repeat(mcpSecret.length - 4) + mcpSecret.slice(-4) : '••••';
      }
      res.json({ settings: masked, port: config.apiPort || 4000 });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/settings/twilio-defaults', (_req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      res.json({
        account_sid: config.settings?.twilio_account_sid || '',
        auth_token: config.settings?.twilio_auth_token || '',
      });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/settings', (req, res) => {
    if (!ctx.configPath) { res.status(503).json({ error: 'Config path not set' }); return; }
    try {
      const config = loadConfig(ctx.configPath, { validate: false });
      if (!config.settings) config.settings = {};
      const allowed = ['twilio_account_sid', 'twilio_auth_token', 'google_api_key', 'elevenlabs_api_key', 'openai_api_key', 'deepgram_api_key', 'anthropic_api_key'];
      const envMap: Record<string, string> = {
        twilio_account_sid: 'TWILIO_ACCOUNT_SID',
        twilio_auth_token: 'TWILIO_AUTH_TOKEN',
        google_api_key: 'GOOGLE_API_KEY',
        elevenlabs_api_key: 'ELEVENLABS_API_KEY',
        openai_api_key: 'OPENAI_API_KEY',
        deepgram_api_key: 'DEEPGRAM_API_KEY',
        anthropic_api_key: 'ANTHROPIC_API_KEY',
      };
      for (const key of allowed) {
        if (key in req.body) {
          const val = req.body[key]?.trim() || '';
          if (val) {
            (config.settings as any)[key] = val;
            process.env[envMap[key]] = val;
          } else {
            delete (config.settings as any)[key];
            delete process.env[envMap[key]];
          }
        }
      }
      // Handle allow_local_webhooks (boolean toggle)
      if ('allow_local_webhooks' in req.body) {
        const val = !!req.body['allow_local_webhooks'];
        (config.settings as any).allow_local_webhooks = val;
        setAllowLocalWebhooks(val);
      }
      if (Object.keys(config.settings).length === 0) delete config.settings;
      // Handle port → config.apiPort
      if ('port' in req.body) {
        const portVal = parseInt(req.body['port'], 10);
        if (portVal >= 1 && portVal <= 65535) {
          config.apiPort = portVal;
        }
      }
      // Handle mcp_secret → config.mcp.secret
      if ('mcp_secret' in req.body) {
        const val = req.body['mcp_secret']?.trim() || '';
        if (!config.mcp) config.mcp = {};
        if (val) {
          config.mcp.secret = val;
          ctx.mcpSecret = val;
        } else {
          delete config.mcp.secret;
          ctx.mcpSecret = null;
        }
      }
      saveConfig(ctx.configPath, config);
      ctx.broadcast({ type: 'configChanged' });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[api]', err); res.status(500).json({ error: 'Internal server error' });
    }
  });
}
