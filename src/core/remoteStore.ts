import { DataStoreConfig } from '../config/types';
import { GroupMapping } from './groupStore';

/**
 * RemoteStore handles syncing all ChannelKit data with a remote REST endpoint.
 *
 * Remote API contract:
 *   GET  /config  → returns YAML config as text/plain
 *   PUT  /config  → accepts YAML config as text/plain body
 *   GET  /auth    → returns auth directory as application/zip
 *   PUT  /auth    → accepts auth directory as application/zip body
 *   GET  /groups  → returns group mappings as application/json
 *   PUT  /groups  → accepts group mappings as application/json body
 */
export class RemoteStore {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private syncIntervalMs: number;
  private endpoint: string;
  private authHeader?: string;

  constructor(private config: DataStoreConfig) {
    this.endpoint = (config.endpoint || '').replace(/\/$/, '');
    this.authHeader = config.auth_header;
    this.syncIntervalMs = (config.sync_interval || 30) * 1000;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.authHeader) h['Authorization'] = this.authHeader;
    if (extra) Object.assign(h, extra);
    return h;
  }

  // ── Config ──────────────────────────────────────────────────────────

  /**
   * Fetch config YAML from the remote endpoint. Returns null if unreachable or empty.
   */
  async fetchConfig(): Promise<string | null> {
    if (!this.endpoint) return null;
    try {
      const res = await fetch(`${this.endpoint}/config`, {
        headers: this.headers({ 'Accept': 'text/plain' }),
      });
      if (res.status === 404) return null; // no config stored yet
      if (!res.ok) {
        console.warn(`[remote-store] Failed to fetch config: HTTP ${res.status}`);
        return null;
      }
      const text = await res.text();
      return text || null;
    } catch (err: any) {
      console.warn(`[remote-store] Failed to fetch config: ${err.message}`);
      return null;
    }
  }

  /**
   * Push config YAML to the remote endpoint.
   */
  async pushConfig(yaml: string): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      const res = await fetch(`${this.endpoint}/config`, {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'text/plain' }),
        body: yaml,
      });
      if (!res.ok) {
        console.warn(`[remote-store] Failed to push config: HTTP ${res.status}`);
        return false;
      }
      console.log('[remote-store] Config synced to remote');
      return true;
    } catch (err: any) {
      console.warn(`[remote-store] Failed to push config: ${err.message}`);
      return false;
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────

  /**
   * Fetch auth data as a ZIP buffer from the remote endpoint.
   */
  async fetchAuth(): Promise<Buffer | null> {
    if (!this.endpoint) return null;
    try {
      const res = await fetch(`${this.endpoint}/auth`, {
        headers: this.headers({ 'Accept': 'application/zip' }),
      });
      if (res.status === 404) return null; // no auth stored yet
      if (!res.ok) {
        console.warn(`[remote-store] Failed to fetch auth: HTTP ${res.status}`);
        return null;
      }
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      return buf.length > 0 ? buf : null;
    } catch (err: any) {
      console.warn(`[remote-store] Failed to fetch auth: ${err.message}`);
      return null;
    }
  }

  /**
   * Push auth data as a ZIP buffer to the remote endpoint.
   */
  async pushAuth(zipBuffer: Buffer): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      const res = await fetch(`${this.endpoint}/auth`, {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'application/zip' }),
        body: zipBuffer,
      });
      if (!res.ok) {
        console.warn(`[remote-store] Failed to push auth: HTTP ${res.status}`);
        return false;
      }
      console.log('[remote-store] Auth synced to remote');
      return true;
    } catch (err: any) {
      console.warn(`[remote-store] Failed to push auth: ${err.message}`);
      return false;
    }
  }

  // ── Groups ──────────────────────────────────────────────────────────

  /**
   * Fetch groups from the remote endpoint. Returns null if unreachable.
   */
  async fetchGroups(): Promise<Record<string, GroupMapping> | null> {
    if (!this.endpoint) return null;
    try {
      const res = await fetch(`${this.endpoint}/groups`, {
        headers: this.headers({ 'Accept': 'application/json' }),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        console.warn(`[remote-store] Failed to fetch groups: HTTP ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data as Record<string, GroupMapping>;
    } catch (err: any) {
      console.warn(`[remote-store] Failed to fetch groups: ${err.message}`);
      return null;
    }
  }

  /**
   * Push groups to the remote endpoint (debounced).
   */
  pushGroups(groups: Record<string, GroupMapping>): void {
    if (!this.endpoint) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.doPushGroups(groups), this.syncIntervalMs);
  }

  /**
   * Immediately push groups to the remote endpoint.
   */
  async pushGroupsNow(groups: Record<string, GroupMapping>): Promise<boolean> {
    return this.doPushGroups(groups);
  }

  private async doPushGroups(groups: Record<string, GroupMapping>): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      const res = await fetch(`${this.endpoint}/groups`, {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(groups),
      });
      if (!res.ok) {
        console.warn(`[remote-store] Failed to push groups: HTTP ${res.status}`);
        return false;
      }
      console.log('[remote-store] Groups synced to remote');
      return true;
    } catch (err: any) {
      console.warn(`[remote-store] Failed to push groups: ${err.message}`);
      return false;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Zip a directory into a buffer using the system `zip` command.
   */
  static async zipDirectory(dirPath: string): Promise<Buffer | null> {
    const { existsSync } = await import('fs');
    const { readFile, rm } = await import('fs/promises');
    const { execFile } = await import('child_process');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { randomBytes } = await import('crypto');

    if (!existsSync(dirPath)) return null;

    // Check if directory has any files
    const { readdirSync } = await import('fs');
    const entries = readdirSync(dirPath);
    if (entries.length === 0) return null;

    const tmpPath = join(tmpdir(), `ck-auth-${randomBytes(4).toString('hex')}.zip`);
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('zip', ['-r', '-q', tmpPath, '.'], { cwd: dirPath }, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        });
      });
      const buf = await readFile(tmpPath);
      await rm(tmpPath, { force: true });
      return buf;
    } catch (err: any) {
      await rm(tmpPath, { force: true }).catch(() => {});
      console.warn(`[remote-store] Failed to zip auth dir: ${err.message}`);
      return null;
    }
  }

  /**
   * Unzip a buffer into a directory using the system `unzip` command.
   */
  static async unzipToDirectory(zipBuffer: Buffer, dirPath: string): Promise<boolean> {
    const { mkdirSync, existsSync } = await import('fs');
    const { writeFile, rm } = await import('fs/promises');
    const { execFile } = await import('child_process');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { randomBytes } = await import('crypto');

    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });

    const tmpPath = join(tmpdir(), `ck-auth-${randomBytes(4).toString('hex')}.zip`);
    try {
      await writeFile(tmpPath, zipBuffer);
      await new Promise<void>((resolve, reject) => {
        execFile('unzip', ['-o', '-q', tmpPath, '-d', dirPath], (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        });
      });
      await rm(tmpPath, { force: true });
      return true;
    } catch (err: any) {
      await rm(tmpPath, { force: true }).catch(() => {});
      console.warn(`[remote-store] Failed to unzip auth: ${err.message}`);
      return false;
    }
  }
}
