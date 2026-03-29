import { platform, homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, writeFileSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { c, ask } from '../helpers';
import { DEFAULT_CONFIG_PATH, CHANNELKIT_HOME } from '../../paths';

const SERVICE_NAME = 'com.channelkit.server';
const SYSTEMD_SERVICE = 'channelkit';

function getNodePath(): string {
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    return 'node';
  }
}

function getChannelKitBin(): string {
  try {
    return execSync('which channelkit', { encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: resolve from current execution
    return resolve(join(__dirname, '..', '..', '..', 'dist', 'cli.js'));
  }
}

function getNpmGlobalPath(): string {
  try {
    return execSync('npm prefix -g', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

// ─── macOS (launchd) ───

function getMacPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_NAME}.plist`);
}

function generatePlist(configPath: string): string {
  const nodePath = getNodePath();
  const ckBin = getChannelKitBin();
  const npmGlobal = getNpmGlobalPath();
  const path = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  if (npmGlobal) path.unshift(join(npmGlobal, 'bin'));
  const nodeDir = nodePath.replace(/\/node$/, '');
  if (!path.includes(nodeDir)) path.unshift(nodeDir);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${ckBin}</string>
    <string>start</string>
    <string>-c</string>
    <string>${configPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${CHANNELKIT_HOME}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path.join(':')}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(CHANNELKIT_HOME, 'channelkit.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(CHANNELKIT_HOME, 'channelkit.log')}</string>
</dict>
</plist>`;
}

function installMac(configPath: string): void {
  const plistPath = getMacPlistPath();
  const plist = generatePlist(configPath);

  // Ensure LaunchAgents directory exists
  const agentsDir = join(homedir(), 'Library', 'LaunchAgents');
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });

  // Unload existing service if present
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' });
  } catch {}

  writeFileSync(plistPath, plist);
  console.log(c('dim', `  Written: ${plistPath}`));

  try {
    execSync(`launchctl load "${plistPath}"`, { encoding: 'utf-8' });
    console.log(c('green', '\n  ✅ Service installed and started!'));
    console.log(c('dim', `\n  ChannelKit will now start automatically on login.`));
    console.log(c('dim', `  Logs: ${join(CHANNELKIT_HOME, 'channelkit.log')}`));
    console.log(c('dim', `\n  Manage with:`));
    console.log(c('cyan', `    channelkit service status`));
    console.log(c('cyan', `    channelkit service stop`));
    console.log(c('cyan', `    channelkit service uninstall\n`));
  } catch (err: any) {
    console.error(c('yellow', `\n  ❌ Failed to load service: ${err.message}`));
    console.log(c('dim', `  Try manually: launchctl load "${plistPath}"\n`));
  }
}

function uninstallMac(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.log(c('dim', '\n  No service installed.\n'));
    return;
  }
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' });
  } catch {}
  unlinkSync(plistPath);
  console.log(c('green', '\n  ✅ Service uninstalled.\n'));
}

function statusMac(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.log(c('dim', '\n  No service installed.\n'));
    return;
  }
  try {
    const output = execSync(`launchctl list | grep ${SERVICE_NAME}`, { encoding: 'utf-8' }).trim();
    if (output) {
      const parts = output.split(/\s+/);
      const pid = parts[0];
      const exitCode = parts[1];
      if (pid && pid !== '-') {
        console.log(c('green', `\n  ✅ Running (PID ${pid})`));
      } else {
        console.log(c('yellow', `\n  ⏹  Stopped (last exit code: ${exitCode})`));
      }
    } else {
      console.log(c('dim', '\n  Service loaded but not found in process list.'));
    }
  } catch {
    console.log(c('yellow', '\n  ⏹  Not running'));
  }
  console.log(c('dim', `  Logs: ${join(CHANNELKIT_HOME, 'channelkit.log')}\n`));
}

function stopMac(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.log(c('dim', '\n  No service installed.\n'));
    return;
  }
  try {
    execSync(`launchctl unload "${plistPath}"`, { encoding: 'utf-8' });
    execSync(`launchctl load "${plistPath}"`, { encoding: 'utf-8' });
    // Actually, to just stop without removing:
  } catch {}
  try {
    execSync(`launchctl stop ${SERVICE_NAME}`, { encoding: 'utf-8' });
    console.log(c('green', '\n  ⏹  Service stopped.\n'));
  } catch {
    console.log(c('yellow', '\n  Service may not be running.\n'));
  }
}

function startMac(): void {
  const plistPath = getMacPlistPath();
  if (!existsSync(plistPath)) {
    console.log(c('yellow', '\n  No service installed. Run: channelkit service install\n'));
    return;
  }
  try {
    execSync(`launchctl load "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' });
  } catch {}
  try {
    execSync(`launchctl start ${SERVICE_NAME}`, { encoding: 'utf-8' });
    console.log(c('green', '\n  ▶  Service started.\n'));
  } catch (err: any) {
    console.error(c('yellow', `\n  ❌ Failed to start: ${err.message}\n`));
  }
}

// ─── Linux (systemd) ───

function getSystemdPath(): string {
  const dir = join(homedir(), '.config', 'systemd', 'user');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${SYSTEMD_SERVICE}.service`);
}

function generateSystemdUnit(configPath: string): string {
  const nodePath = getNodePath();
  const ckBin = getChannelKitBin();

  return `[Unit]
Description=ChannelKit Messaging Gateway
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${ckBin} start -c ${configPath}
WorkingDirectory=${CHANNELKIT_HOME}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

function installLinux(configPath: string): void {
  const unitPath = getSystemdPath();
  const unit = generateSystemdUnit(configPath);

  writeFileSync(unitPath, unit);
  console.log(c('dim', `  Written: ${unitPath}`));

  try {
    execSync('systemctl --user daemon-reload', { encoding: 'utf-8' });
    execSync(`systemctl --user enable ${SYSTEMD_SERVICE}`, { encoding: 'utf-8' });
    execSync(`systemctl --user start ${SYSTEMD_SERVICE}`, { encoding: 'utf-8' });
    // Enable lingering so service starts on boot even without login
    execSync('loginctl enable-linger', { encoding: 'utf-8' });
    console.log(c('green', '\n  ✅ Service installed and started!'));
    console.log(c('dim', `\n  ChannelKit will now start automatically on boot.`));
    console.log(c('dim', `  Logs: journalctl --user -u ${SYSTEMD_SERVICE} -f`));
    console.log(c('dim', `\n  Manage with:`));
    console.log(c('cyan', `    channelkit service status`));
    console.log(c('cyan', `    channelkit service stop`));
    console.log(c('cyan', `    channelkit service uninstall\n`));
  } catch (err: any) {
    console.error(c('yellow', `\n  ❌ Failed to start service: ${err.message}`));
    console.log(c('dim', `  Try manually: systemctl --user start ${SYSTEMD_SERVICE}\n`));
  }
}

function uninstallLinux(): void {
  const unitPath = getSystemdPath();
  if (!existsSync(unitPath)) {
    console.log(c('dim', '\n  No service installed.\n'));
    return;
  }
  try {
    execSync(`systemctl --user stop ${SYSTEMD_SERVICE} 2>/dev/null`, { encoding: 'utf-8' });
    execSync(`systemctl --user disable ${SYSTEMD_SERVICE} 2>/dev/null`, { encoding: 'utf-8' });
  } catch {}
  unlinkSync(unitPath);
  try {
    execSync('systemctl --user daemon-reload', { encoding: 'utf-8' });
  } catch {}
  console.log(c('green', '\n  ✅ Service uninstalled.\n'));
}

function statusLinux(): void {
  const unitPath = getSystemdPath();
  if (!existsSync(unitPath)) {
    console.log(c('dim', '\n  No service installed.\n'));
    return;
  }
  try {
    const output = execSync(`systemctl --user is-active ${SYSTEMD_SERVICE}`, { encoding: 'utf-8' }).trim();
    if (output === 'active') {
      console.log(c('green', '\n  ✅ Running'));
    } else {
      console.log(c('yellow', `\n  ⏹  ${output}`));
    }
  } catch {
    console.log(c('yellow', '\n  ⏹  Not running'));
  }
  console.log(c('dim', `  Logs: journalctl --user -u ${SYSTEMD_SERVICE} -f\n`));
}

function stopLinux(): void {
  try {
    execSync(`systemctl --user stop ${SYSTEMD_SERVICE}`, { encoding: 'utf-8' });
    console.log(c('green', '\n  ⏹  Service stopped.\n'));
  } catch {
    console.log(c('yellow', '\n  Service may not be running.\n'));
  }
}

function startLinux(): void {
  const unitPath = getSystemdPath();
  if (!existsSync(unitPath)) {
    console.log(c('yellow', '\n  No service installed. Run: channelkit service install\n'));
    return;
  }
  try {
    execSync(`systemctl --user start ${SYSTEMD_SERVICE}`, { encoding: 'utf-8' });
    console.log(c('green', '\n  ▶  Service started.\n'));
  } catch (err: any) {
    console.error(c('yellow', `\n  ❌ Failed to start: ${err.message}\n`));
  }
}

// ─── Public API ───

const os = platform();

export function installServiceCommand(configPath: string): void {
  const resolved = resolve(configPath);
  console.log(c('cyan', '\n  📦 Installing ChannelKit as a system service...\n'));

  if (os === 'darwin') {
    installMac(resolved);
  } else if (os === 'linux') {
    installLinux(resolved);
  } else {
    console.log(c('yellow', `\n  ❌ Unsupported platform: ${os}`));
    console.log(c('dim', '  Supported: macOS (launchd), Linux (systemd)\n'));
  }
}

export function uninstallServiceCommand(): void {
  if (os === 'darwin') uninstallMac();
  else if (os === 'linux') uninstallLinux();
  else console.log(c('yellow', `\n  ❌ Unsupported platform: ${os}\n`));
}

export function serviceStatusCommand(): void {
  if (os === 'darwin') statusMac();
  else if (os === 'linux') statusLinux();
  else console.log(c('yellow', `\n  ❌ Unsupported platform: ${os}\n`));
}

export function serviceStopCommand(): void {
  if (os === 'darwin') stopMac();
  else if (os === 'linux') stopLinux();
  else console.log(c('yellow', `\n  ❌ Unsupported platform: ${os}\n`));
}

export function serviceStartCommand(): void {
  if (os === 'darwin') startMac();
  else if (os === 'linux') startLinux();
  else console.log(c('yellow', `\n  ❌ Unsupported platform: ${os}\n`));
}

/** Prompt user to install service after first successful start */
export async function promptServiceInstall(configPath: string): Promise<void> {
  // Don't prompt if already installed
  if (os === 'darwin' && existsSync(getMacPlistPath())) return;
  if (os === 'linux' && existsSync(getSystemdPath())) return;
  if (os !== 'darwin' && os !== 'linux') return;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log();
    const answer = await ask(rl, 'Install as a system service? (starts on boot) [y/N]', 'N');
    if (answer.toLowerCase() === 'y') {
      rl.close();
      installServiceCommand(configPath);
    } else {
      console.log(c('dim', '\n  No problem! You can install later with: channelkit service install\n'));
    }
  } finally {
    rl.close();
  }
}
