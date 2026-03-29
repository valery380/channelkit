import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { Channel } from '../channels/base';
import { restartProcess } from './restart';

export interface UpdateStatus {
  mode: 'git' | 'npm';
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  behindCount: number;
  lastChecked: number;
}

export interface UpdateResult {
  success: boolean;
  previousVersion: string;
  newVersion: string;
  error?: string;
}

const PKG_NAME = '@dirbalak/channelkit';

export class Updater {
  private lastStatus: UpdateStatus | null = null;
  private autoUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private projectRoot: string;
  private updating = false;
  private mode: 'git' | 'npm';

  constructor(
    private channels: Map<string, Channel>,
    private onLog?: (message: string) => void,
  ) {
    this.projectRoot = process.cwd();
    this.mode = this.detectMode();
    this.log(`Running in ${this.mode} mode`);
  }

  private detectMode(): 'git' | 'npm' {
    // If there's a .git directory in the project root, it's a git clone
    if (existsSync(join(this.projectRoot, '.git'))) return 'git';
    return 'npm';
  }

  private log(msg: string): void {
    const formatted = `[updater] ${msg}`;
    console.log(formatted);
    this.onLog?.(formatted);
  }

  private exec(cmd: string, timeout = 30000): string {
    return execSync(cmd, { cwd: this.projectRoot, encoding: 'utf-8', timeout }).trim();
  }

  getCurrentVersion(): string {
    if (this.mode === 'git') {
      try {
        return this.exec('git rev-parse --short HEAD');
      } catch {
        return 'unknown';
      }
    }
    // npm mode — read version from our own package.json
    try {
      const pkgPath = join(__dirname, '..', '..', 'package.json');
      return require(pkgPath).version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  getLastStatus(): UpdateStatus | null {
    return this.lastStatus;
  }

  async checkForUpdate(): Promise<UpdateStatus> {
    if (this.mode === 'git') {
      return this.checkGitUpdate();
    }
    return this.checkNpmUpdate();
  }

  private async checkGitUpdate(): Promise<UpdateStatus> {
    const currentVersion = this.getCurrentVersion();

    try {
      this.exec('git fetch origin main', 30000);
    } catch (err: any) {
      this.log(`Failed to fetch from origin: ${err.message}`);
      this.lastStatus = {
        mode: 'git',
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        behindCount: 0,
        lastChecked: Date.now(),
      };
      return this.lastStatus;
    }

    const latestVersion = this.exec('git rev-parse --short origin/main');
    const currentFull = this.exec('git rev-parse HEAD');
    const remoteFull = this.exec('git rev-parse origin/main');

    let behindCount = 0;
    try {
      behindCount = parseInt(this.exec('git rev-list HEAD..origin/main --count')) || 0;
    } catch {}

    const updateAvailable = currentFull !== remoteFull;

    this.lastStatus = {
      mode: 'git',
      currentVersion,
      latestVersion,
      updateAvailable,
      behindCount,
      lastChecked: Date.now(),
    };

    if (updateAvailable) {
      this.log(`Update available: ${currentVersion} -> ${latestVersion} (${behindCount} commit(s) behind)`);
    }

    return this.lastStatus;
  }

  private async checkNpmUpdate(): Promise<UpdateStatus> {
    const currentVersion = this.getCurrentVersion();

    let latestVersion = currentVersion;
    try {
      latestVersion = this.exec(`npm view ${PKG_NAME} version`, 15000);
    } catch (err: any) {
      this.log(`Failed to check npm registry: ${err.message}`);
      this.lastStatus = {
        mode: 'npm',
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        behindCount: 0,
        lastChecked: Date.now(),
      };
      return this.lastStatus;
    }

    const updateAvailable = currentVersion !== latestVersion;

    this.lastStatus = {
      mode: 'npm',
      currentVersion,
      latestVersion,
      updateAvailable,
      behindCount: updateAvailable ? 1 : 0,
      lastChecked: Date.now(),
    };

    if (updateAvailable) {
      this.log(`Update available: ${currentVersion} -> ${latestVersion}`);
    }

    return this.lastStatus;
  }

  async performUpdate(): Promise<UpdateResult> {
    if (this.updating) {
      return { success: false, previousVersion: '', newVersion: '', error: 'Update already in progress' };
    }

    this.updating = true;

    if (this.mode === 'git') {
      return this.performGitUpdate();
    }
    return this.performNpmUpdate();
  }

  private async performGitUpdate(): Promise<UpdateResult> {
    const previousVersion = this.getCurrentVersion();

    try {
      const dirty = this.exec('git status --porcelain');
      if (dirty) {
        this.updating = false;
        return { success: false, previousVersion, newVersion: previousVersion, error: 'Working tree has uncommitted changes. Commit or stash them first.' };
      }

      this.log('Pulling latest changes from origin/main...');
      this.exec('git pull origin main', 60000);

      this.log('Installing dependencies...');
      this.exec('npm install', 120000);

      this.log('Building...');
      this.exec('npm run build', 120000);

      const newVersion = this.getCurrentVersion();
      this.log(`Update complete: ${previousVersion} -> ${newVersion}. Restarting...`);

      setTimeout(() => restartProcess(this.channels), 500);

      return { success: true, previousVersion, newVersion };
    } catch (err: any) {
      this.updating = false;
      this.log(`Update failed: ${err.message}`);
      return { success: false, previousVersion, newVersion: previousVersion, error: err.message };
    }
  }

  private async performNpmUpdate(): Promise<UpdateResult> {
    const previousVersion = this.getCurrentVersion();

    try {
      this.log(`Updating ${PKG_NAME} via npm...`);

      // Detect if installed globally or locally
      const isGlobal = this.isGlobalInstall();
      const installCmd = isGlobal
        ? `npm install -g ${PKG_NAME}@latest`
        : `npm install ${PKG_NAME}@latest`;

      this.log(`Running: ${installCmd}`);
      this.exec(installCmd, 120000);

      const newVersion = this.exec(`npm view ${PKG_NAME} version`, 15000);
      this.log(`Update complete: ${previousVersion} -> ${newVersion}. Restarting...`);

      setTimeout(() => restartProcess(this.channels), 500);

      return { success: true, previousVersion, newVersion };
    } catch (err: any) {
      this.updating = false;
      this.log(`Update failed: ${err.message}`);
      return { success: false, previousVersion, newVersion: previousVersion, error: err.message };
    }
  }

  private isGlobalInstall(): boolean {
    try {
      const globalPrefix = this.exec('npm prefix -g');
      // If our package's path starts with the global prefix, it's a global install
      return __dirname.startsWith(globalPrefix);
    } catch {
      return false;
    }
  }

  /** Check for updates periodically without installing (notify only). */
  startUpdateCheck(intervalMinutes: number): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    this.log(`Update check enabled (notify only): checking every ${intervalMinutes} minute(s)`);

    // Initial check after 10s
    setTimeout(() => this.notifyUpdateCheck(), 10000);

    this.autoUpdateTimer = setInterval(() => this.notifyUpdateCheck(), intervalMs);
  }

  private async notifyUpdateCheck(): Promise<void> {
    try {
      const status = await this.checkForUpdate();
      if (status.updateAvailable) {
        const msg = status.mode === 'npm'
          ? `Update available: v${status.currentVersion} → v${status.latestVersion}. Run: npm update -g ${PKG_NAME}`
          : `Update available: ${status.currentVersion} → ${status.latestVersion} (${status.behindCount} commit(s) behind). Run: git pull`;
        this.log(msg);
        console.log(`\n  ╭─────────────────────────────────────────╮`);
        console.log(`  │  🆕 New version available!               │`);
        console.log(`  │  ${status.currentVersion} → ${status.latestVersion}${' '.repeat(Math.max(0, 27 - status.currentVersion.length - status.latestVersion.length))}│`);
        console.log(`  │  Auto-update is off. Update manually:    │`);
        console.log(`  │  ${status.mode === 'npm' ? `npm update -g ${PKG_NAME}` : 'git pull && npm run build'}${' '.repeat(Math.max(0, status.mode === 'npm' ? 5 : 14))}│`);
        console.log(`  ╰─────────────────────────────────────────╯\n`);
      }
    } catch (err: any) {
      this.log(`Update check failed: ${err.message}`);
    }
  }

  startAutoUpdate(intervalMinutes: number): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    this.log(`Auto-update enabled: checking every ${intervalMinutes} minute(s)`);

    setTimeout(() => this.autoUpdateCheck(), 10000);

    this.autoUpdateTimer = setInterval(() => this.autoUpdateCheck(), intervalMs);
  }

  stopAutoUpdate(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
      this.log('Auto-update disabled');
    }
  }

  private async autoUpdateCheck(): Promise<void> {
    try {
      const status = await this.checkForUpdate();
      if (status.updateAvailable) {
        this.log(`Auto-update: new version detected (${status.latestVersion}). Updating...`);
        await this.performUpdate();
      }
    } catch (err: any) {
      this.log(`Auto-update check failed: ${err.message}`);
    }
  }
}
