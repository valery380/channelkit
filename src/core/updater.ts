import { execSync } from 'child_process';
import { Channel } from '../channels/base';
import { restartProcess } from './restart';

export interface UpdateStatus {
  currentCommit: string;
  remoteCommit: string;
  updateAvailable: boolean;
  behindCount: number;
  lastChecked: number;
}

export interface UpdateResult {
  success: boolean;
  previousCommit: string;
  newCommit: string;
  error?: string;
}

export class Updater {
  private lastStatus: UpdateStatus | null = null;
  private autoUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private projectRoot: string;
  private updating = false;

  constructor(
    private channels: Map<string, Channel>,
    private onLog?: (message: string) => void,
  ) {
    this.projectRoot = process.cwd();
  }

  private log(msg: string): void {
    const formatted = `[updater] ${msg}`;
    console.log(formatted);
    this.onLog?.(formatted);
  }

  private exec(cmd: string, timeout = 30000): string {
    return execSync(cmd, { cwd: this.projectRoot, encoding: 'utf-8', timeout }).trim();
  }

  getCurrentCommit(): string {
    try {
      return this.exec('git rev-parse --short HEAD');
    } catch {
      return 'unknown';
    }
  }

  getLastStatus(): UpdateStatus | null {
    return this.lastStatus;
  }

  async checkForUpdate(): Promise<UpdateStatus> {
    const currentCommit = this.getCurrentCommit();

    try {
      this.exec('git fetch origin main', 30000);
    } catch (err: any) {
      this.log(`Failed to fetch from origin: ${err.message}`);
      this.lastStatus = {
        currentCommit,
        remoteCommit: currentCommit,
        updateAvailable: false,
        behindCount: 0,
        lastChecked: Date.now(),
      };
      return this.lastStatus;
    }

    const remoteCommit = this.exec('git rev-parse --short origin/main');
    const currentFull = this.exec('git rev-parse HEAD');
    const remoteFull = this.exec('git rev-parse origin/main');

    let behindCount = 0;
    try {
      behindCount = parseInt(this.exec('git rev-list HEAD..origin/main --count')) || 0;
    } catch {}

    const updateAvailable = currentFull !== remoteFull;

    this.lastStatus = {
      currentCommit,
      remoteCommit,
      updateAvailable,
      behindCount,
      lastChecked: Date.now(),
    };

    if (updateAvailable) {
      this.log(`Update available: ${currentCommit} -> ${remoteCommit} (${behindCount} commit(s) behind)`);
    }

    return this.lastStatus;
  }

  async performUpdate(): Promise<UpdateResult> {
    if (this.updating) {
      return { success: false, previousCommit: '', newCommit: '', error: 'Update already in progress' };
    }

    this.updating = true;
    const previousCommit = this.getCurrentCommit();

    try {
      // Check for dirty working tree
      const dirty = this.exec('git status --porcelain');
      if (dirty) {
        this.updating = false;
        return { success: false, previousCommit, newCommit: previousCommit, error: 'Working tree has uncommitted changes. Commit or stash them first.' };
      }

      this.log('Pulling latest changes from origin/main...');
      this.exec('git pull origin main', 60000);

      this.log('Installing dependencies...');
      this.exec('npm install', 120000);

      this.log('Building...');
      this.exec('npm run build', 120000);

      const newCommit = this.getCurrentCommit();
      this.log(`Update complete: ${previousCommit} -> ${newCommit}. Restarting...`);

      // Schedule restart
      setTimeout(() => restartProcess(this.channels), 500);

      return { success: true, previousCommit, newCommit };
    } catch (err: any) {
      this.updating = false;
      this.log(`Update failed: ${err.message}`);
      return { success: false, previousCommit, newCommit: previousCommit, error: err.message };
    }
  }

  startAutoUpdate(intervalMinutes: number): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    this.log(`Auto-update enabled: checking every ${intervalMinutes} minute(s)`);

    // Initial check after a short delay
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
        this.log(`Auto-update: new version detected (${status.remoteCommit}). Updating...`);
        await this.performUpdate();
      }
    } catch (err: any) {
      this.log(`Auto-update check failed: ${err.message}`);
    }
  }
}
