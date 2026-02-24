import { resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { c, ask, select, promptApiKey } from '../helpers';

export async function serviceAddWizard(opts: { config: string } = { config: 'config.yaml' }, rl?: ReturnType<typeof createInterface>) {
  const configPath = typeof opts.config === 'string' ? resolve(opts.config) : resolve('config.yaml');
  if (!existsSync(configPath)) {
    console.error(c('yellow', `\n  ❌ Config file not found: ${configPath}\n  Run 'channelkit init' first.\n`));
    process.exit(1);
  }

  const { loadConfig, saveConfig } = await import('../../config/parser');
  const config = loadConfig(configPath, { validate: false });

  const closeRl = !rl;
  if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(c('cyan', '\n  📦 Add a new service\n'));

    const name = await ask(rl, 'Service name:', 'Onkosto');
    if (!name) { if (closeRl) rl!.close(); return; }

    const channelNames = Object.keys(config.channels);
    if (channelNames.length === 0) {
      console.log(c('yellow', '\n  ⚠️  No channels configured. Run `channelkit init` first.\n'));
      if (closeRl) rl!.close();
      return;
    }

    let selectedChannel: string;
    if (channelNames.length === 1) {
      selectedChannel = channelNames[0];
      const chType = (config.channels[selectedChannel] as any).type;
      console.log(c('dim', `\n  Channel: ${selectedChannel} (${chType})`));
    } else {
      const options = channelNames.map(ch => {
        const cfg = config.channels[ch] as any;
        const icon = cfg.type === 'whatsapp' ? '📱' : cfg.type === 'telegram' ? '💬' : '📧';
        return `${icon} ${ch} (${cfg.type})`;
      });
      const chIdx = await select(rl, 'Which channel?', options);
      selectedChannel = channelNames[chIdx];
    }

    const webhook = await ask(rl, 'Webhook URL:', 'http://localhost:3000');

    if (!config.services) config.services = {};
    const existingOnChannel = Object.values(config.services).filter(s => s.channel === selectedChannel);
    const chType = (config.channels[selectedChannel] as any).type;
    
    let code: string | undefined;
    let command: string | undefined;

    if (existingOnChannel.length > 0) {
      if (chType === 'telegram') {
        console.log(c('dim', `\n  This channel already has ${existingOnChannel.length} service(s) → slash command mode`));
        const suggestedCmd = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        command = await ask(rl, 'Slash command (without /):', suggestedCmd);
        
        for (const [svcName, svc] of Object.entries(config.services)) {
          if (svc.channel === selectedChannel && !svc.command) {
            const existingCmd = svcName.toLowerCase().replace(/[^a-z0-9]/g, '');
            console.log(c('yellow', `\n  ⚠️  Existing service "${svcName}" needs a slash command too`));
            svc.command = await ask(rl, `Slash command for "${svcName}" (without /):`, existingCmd);
          }
        }
      } else {
        console.log(c('dim', `\n  This channel already has ${existingOnChannel.length} service(s) → groups mode`));
        const suggestedCode = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
        code = await ask(rl, 'Magic code for onboarding:', suggestedCode);
        
        for (const [svcName, svc] of Object.entries(config.services)) {
          if (svc.channel === selectedChannel && !svc.code) {
            const existingCode = svcName.toUpperCase().replace(/[^A-Z0-9]/g, '');
            console.log(c('yellow', `\n  ⚠️  Existing service "${svcName}" needs a magic code too (for groups mode)`));
            svc.code = await ask(rl, `Magic code for "${svcName}":`, existingCode);
          }
        }
      }
    }

    let stt: any = undefined;
    let tts: any = undefined;

    const enableStt = await ask(rl, 'Enable speech-to-text for voice messages? (y/N):', 'N');
    if (enableStt.toLowerCase() === 'y') {
      const sttProviderIdx = await select(rl, 'STT provider:', [
        '🔵 Google Cloud Speech-to-Text',
        '🟢 OpenAI Whisper',
        '🟣 Deepgram',
      ]);
      const sttProvider = ['google', 'whisper', 'deepgram'][sttProviderIdx];
      const sttLanguage = await ask(rl, 'Primary language (e.g. en-US, he-IL):', 'en-US');
      stt = { provider: sttProvider, language: sttLanguage };
      await promptApiKey(rl, sttProvider, opts.config);
    }

    const enableTts = await ask(rl, 'Enable text-to-speech for responses? (y/N):', 'N');
    if (enableTts.toLowerCase() === 'y') {
      const ttsProviderIdx = await select(rl, 'TTS provider:', [
        '🔵 Google Cloud Text-to-Speech',
        '🟡 ElevenLabs',
        '🟢 OpenAI TTS',
      ]);
      const ttsProvider = ['google', 'elevenlabs', 'openai'][ttsProviderIdx];
      const ttsVoice = await ask(rl, 'Voice ID (optional, press Enter to skip):');
      tts = { provider: ttsProvider, ...(ttsVoice ? { voice: ttsVoice } : {}) };
      await promptApiKey(rl, ttsProvider, opts.config);
    }

    let voice: any = undefined;
    if (chType === 'voice') {
      console.log(c('cyan', '\n  📞 Voice call settings\n'));
      const greeting = await ask(rl!, 'Greeting message:', 'Hello. Please speak after the beep.');
      const holdMessage = await ask(rl!, 'Hold message (while processing, optional):');
      const language = await ask(rl!, 'Language (e.g. en-US, he-IL):', 'en-US');
      const voiceName = await ask(rl!, 'Voice name (e.g. Polly.Joanna, optional):');
      const conversational = await ask(rl!, 'Conversational mode (loop record→respond)? (y/N):', 'N');
      const maxRecord = await ask(rl!, 'Max recording seconds:', '30');

      voice = {
        greeting,
        ...(holdMessage ? { hold_message: holdMessage } : {}),
        language,
        ...(voiceName ? { voice_name: voiceName } : {}),
        conversational: conversational.toLowerCase() === 'y',
        max_record_seconds: parseInt(maxRecord) || 30,
      };
    }

    if (config.services[name]) {
      console.log(c('yellow', `\n  ⚠️  Service "${name}" already exists.\n`));
      if (closeRl) rl!.close();
      return;
    }

    config.services[name] = {
      channel: selectedChannel,
      webhook,
      ...(code ? { code: code.toUpperCase() } : {}),
      ...(command ? { command: command.toLowerCase().replace(/^\//, '') } : {}),
      ...(stt ? { stt } : {}),
      ...(tts ? { tts } : {}),
      ...(voice ? { voice } : {}),
    };
    saveConfig(configPath, config);

    const chCfg = config.channels[selectedChannel] as any;
    const number = chCfg?.number?.replace(/[^0-9]/g, '') || '';

    console.log(c('green', `\n  ✅ Service "${name}" added!\n`));
    console.log(c('dim', `  Channel: ${selectedChannel} (${chCfg.type})`));
    console.log(c('dim', `  Webhook: ${webhook}`));
    if (code) {
      console.log(c('dim', `  Code:    ${code.toUpperCase()}`));
      if (chCfg.type === 'whatsapp' && number) {
        console.log(c('cyan', `\n  📱 Share: https://wa.me/${number}?text=${encodeURIComponent(code.toUpperCase())}`));
      }
    }
    if (command) {
      console.log(c('dim', `  Command: /${command}`));
    }
    console.log();
  } finally {
    if (closeRl) rl!.close();
  }
}
