import { createInterface } from 'readline';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join, dirname, resolve } from 'path';

export const LOGO = `
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

export const COLORS = {
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

export function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

export function banner() {
  console.log(c('cyan', LOGO));
  console.log(c('dim', `  v0.1.0\n`));
}

export async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? c('dim', ` (${defaultVal})`) : '';
  return new Promise((resolve) => {
    rl.question(`  ${c('green', '?')} ${question}${suffix} `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

export async function select(rl: ReturnType<typeof createInterface>, question: string, options: string[]): Promise<number> {
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

// --- .env helpers ---
export const API_KEY_INFO: Record<string, { envVar: string; hint: string }> = {
  google:     { envVar: 'GOOGLE_API_KEY',     hint: 'Get one at https://console.cloud.google.com/apis/credentials' },
  whisper:    { envVar: 'OPENAI_API_KEY',     hint: 'Get one at https://platform.openai.com/api-keys' },
  deepgram:   { envVar: 'DEEPGRAM_API_KEY',   hint: 'Get one at https://console.deepgram.com' },
  elevenlabs: { envVar: 'ELEVENLABS_API_KEY', hint: 'Get one at https://elevenlabs.io/api' },
  openai:     { envVar: 'OPENAI_API_KEY',     hint: 'Get one at https://platform.openai.com/api-keys' },
};

export function readEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, 'utf-8');
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

export function saveEnvVar(envPath: string, key: string, value: string): void {
  const existing = readEnvFile(envPath);
  if (existing[key]) return;
  const line = `${key}=${value}\n`;
  appendFileSync(envPath, line);
}

export async function promptApiKey(
  rl: ReturnType<typeof createInterface>,
  provider: string,
  configPath: string,
): Promise<void> {
  const info = API_KEY_INFO[provider];
  if (!info) return;

  const envPath = join(dirname(resolve(configPath)), '.env');
  const envVars = readEnvFile(envPath);

  if (process.env[info.envVar] || envVars[info.envVar]) {
    console.log(c('dim', `\n  ✓ ${info.envVar} already set`));
    return;
  }

  console.log(c('dim', `\n  ${info.hint}`));
  const value = await ask(rl, `${info.envVar}:`);
  if (value) {
    saveEnvVar(envPath, info.envVar, value);
    process.env[info.envVar] = value;
    console.log(c('green', `  ✓ Saved to .env`));
    console.log(c('yellow', `  💡 Make sure .env is in your .gitignore`));
  }
}
