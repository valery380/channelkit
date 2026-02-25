import { resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { banner, c, ask, select } from '../helpers';

export async function provisionWhatsAppWizard(opts: { config: string }) {
  banner();
  console.log(c('bright', '  📱 Provision a WhatsApp number\n'));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(c('dim', '  We\'ll use Twilio to buy a number and receive the WhatsApp\n  verification SMS automatically.\n'));
    console.log(c('dim', '  Don\'t have a Twilio account? Sign up at https://twilio.com\n'));

    const accountSid = await ask(rl, 'Twilio Account SID:');
    const authToken = await ask(rl, 'Twilio Auth Token:');

    if (!accountSid || !authToken) {
      console.log(c('yellow', '\n  ❌ Account SID and Auth Token are required.\n'));
      rl.close();
      return;
    }

    console.log(c('dim', '\n  Connecting to Twilio...'));

    const { TwilioProvisioner } = await import('../../provisioning/twilio');
    const twilio = new TwilioProvisioner({ accountSid, authToken });

    const country = await ask(rl, 'Country code (e.g. US, GB, IL):', 'US');

    console.log(c('dim', `\n  Searching for mobile numbers in ${country}...\n`));

    let numbers;
    try {
      numbers = await twilio.searchNumbers(country, { type: 'mobile', limit: 5 });
    } catch (err: any) {
      console.log(c('dim', '  No mobile numbers found, trying local numbers...\n'));
      numbers = await twilio.searchNumbers(country, { type: 'local', limit: 5 });
    }

    if (numbers.length === 0) {
      console.log(c('yellow', '  ❌ No numbers available in this country.\n'));
      rl.close();
      return;
    }

    const idx = await select(rl, 'Choose a number:', numbers.map(n => {
      const features = [
        n.capabilities.sms ? 'SMS' : '',
        n.capabilities.voice ? 'Voice' : '',
      ].filter(Boolean).join(', ');
      return `${n.phoneNumber}  ${c('dim', `(${n.locality || n.region || n.isoCountry}) [${features}]`)}`;
    }));

    const chosen = numbers[idx];
    console.log(c('dim', `\n  Purchasing ${chosen.phoneNumber}...`));

    const purchased = await twilio.purchaseNumber(chosen.phoneNumber);
    console.log(c('green', `  ✅ Purchased: ${purchased.phoneNumber}\n`));

    const configPath = resolve(opts.config);
    if (existsSync(configPath)) {
      const { loadConfig, saveConfig } = await import('../../config/parser');
      const config = loadConfig(configPath);

      const waKey = Object.keys(config.channels).find(k => (config.channels[k] as any).type === 'whatsapp') || 'whatsapp';
      config.channels[waKey] = { type: 'whatsapp', number: purchased.phoneNumber };

      (config as any).providers = (config as any).providers || {};
      (config as any).providers.twilio = { accountSid, numberSid: purchased.sid };

      saveConfig(configPath, config);
      console.log(c('dim', `  Updated ${configPath} with new number.\n`));
    }

    console.log(c('bright', '\n  📲 Step 2: Register with WhatsApp\n'));
    console.log(c('white', '  Now add this number as a second account on your WhatsApp:\n'));
    console.log(c('dim', '  1. Open WhatsApp on your phone'));
    console.log(c('dim', '  2. Go to Settings → Add Account (or switch accounts)'));
    console.log(c('dim', `  3. Enter the new number: ${c('cyan', purchased.phoneNumber)}`));
    console.log(c('dim', '  4. WhatsApp will send an SMS to verify the number'));
    console.log(c('dim', '  5. We\'ll catch the SMS automatically via Twilio!\n'));

    const ready = await ask(rl, 'Ready? Press Enter when you\'ve requested the SMS verification in WhatsApp...');

    console.log(c('dim', '\n  ⏳ Waiting for WhatsApp verification SMS...'));
    
    let dots = 0;
    const code = await twilio.waitForSms(purchased.phoneNumber, 120000, () => {
      dots = (dots + 1) % 4;
      process.stdout.write(`\r  ⏳ Waiting for SMS${'·'.repeat(dots)}${' '.repeat(3 - dots)}  `);
    });

    console.log(`\r                                        `);
    console.log(c('green', `\n  ╔═══════════════════════════════════════╗`));
    console.log(c('green', `  ║                                       ║`));
    console.log(c('green', `  ║   📬 Verification code: ${c('bright', code)}        ║`));
    console.log(c('green', `  ║                                       ║`));
    console.log(c('green', `  ╚═══════════════════════════════════════╝`));
    console.log(c('white', `\n  Enter this code in WhatsApp to complete registration.\n`));

    await ask(rl, 'Press Enter once WhatsApp is set up on the new number...');

    console.log(c('bright', '\n  🔗 Step 3: Connect ChannelKit\n'));
    console.log(c('dim', '  Now we\'ll connect ChannelKit as a linked device...\n'));

    const { useMultiFileAuthState, makeCacheableSignalKeyStore } = await import('@whiskeysockets/baileys');
    const makeWASocket = (await import('@whiskeysockets/baileys')).default;
    const { join } = await import('path');
    const { mkdirSync, existsSync: dirExists } = await import('fs');

    const authDir = join('.', 'auth', `whatsapp-provisioned`);
    if (!dirExists(authDir)) mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const phoneForPairing = purchased.phoneNumber.replace(/[^0-9]/g, '');

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
    });

    sock.ev.on('creds.update', saveCreds);

    await new Promise<void>((resolveConn, rejectConn) => {
      let pairingRequested = false;
      const timeout = setTimeout(() => {
        sock.end(undefined);
        rejectConn(new Error('Connection timeout'));
      }, 120000);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if ((connection === 'connecting' || qr) && !pairingRequested) {
          pairingRequested = true;
          try {
            const pairingCode = await sock.requestPairingCode(phoneForPairing);
            const formatted = pairingCode.match(/.{1,4}/g)?.join('-') || pairingCode;

            console.log(c('green', '  ╔═══════════════════════════════════════╗'));
            console.log(c('green', '  ║                                       ║'));
            console.log(c('green', `  ║   Pairing code: ${c('bright', formatted)}          ║`));
            console.log(c('green', '  ║                                       ║'));
            console.log(c('green', '  ╚═══════════════════════════════════════╝'));
            console.log();
            console.log(c('white', '  On your phone:'));
            console.log(c('dim', `  1. Switch to the ${purchased.phoneNumber} account in WhatsApp`));
            console.log(c('dim', '  2. Go to Settings → Linked Devices → Link a Device'));
            console.log(c('dim', '  3. Tap "Link with phone number instead"'));
            console.log(c('dim', `  4. Enter: ${purchased.phoneNumber}`));
            console.log(c('dim', `  5. Enter the pairing code: ${formatted}`));
            console.log(c('dim', '\n  Waiting for pairing...\n'));
          } catch (err: any) {
            clearTimeout(timeout);
            sock.end(undefined);
            rejectConn(new Error(`Failed to request pairing code: ${err.message}`));
          }
        }

        if (connection === 'open') {
          clearTimeout(timeout);
          sock.end(undefined);
          resolveConn();
        }

        if (connection === 'close') {
          const reason = (lastDisconnect?.error as any)?.output?.statusCode;
          if (reason === 515) {
            clearTimeout(timeout);
            sock.end(undefined);
            resolveConn();
          }
        }
      });
    });

    console.log(c('green', '  ╔═══════════════════════════════════════════╗'));
    console.log(c('green', '  ║                                           ║'));
    console.log(c('green', '  ║   🎉 Provisioning complete!               ║'));
    console.log(c('green', '  ║                                           ║'));
    console.log(c('green', `  ║   Number: ${purchased.phoneNumber.padEnd(28)}║`));
    console.log(c('green', '  ║   WhatsApp: Connected ✅                  ║'));
    console.log(c('green', '  ║                                           ║'));
    console.log(c('green', '  ╚═══════════════════════════════════════════╝'));
    console.log();
    console.log(c('white', '  Start ChannelKit:\n'));
    console.log(c('cyan', '    npm start\n'));

  } catch (err: any) {
    console.error(c('yellow', `\n  ❌ ${err.message}\n`));
  } finally {
    rl.close();
  }
}
