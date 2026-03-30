import { DataStoreConfig } from '../config/types';
import { GroupMapping } from './groupStore';

/**
 * RemoteStore handles syncing group data with a remote REST endpoint.
 * - On startup: fetches groups from GET `endpoint`/groups
 * - On changes: debounced PUT `endpoint`/groups with updated data
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

  /**
   * Fetch groups from the remote endpoint. Returns null if unreachable.
   */
  async fetchGroups(): Promise<Record<string, GroupMapping> | null> {
    if (!this.endpoint) return null;
    try {
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (this.authHeader) headers['Authorization'] = this.authHeader;

      const res = await fetch(`${this.endpoint}/groups`, { headers });
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
    this.debounceTimer = setTimeout(() => this.doPush(groups), this.syncIntervalMs);
  }

  /**
   * Immediately push groups to the remote endpoint.
   */
  async pushGroupsNow(groups: Record<string, GroupMapping>): Promise<boolean> {
    return this.doPush(groups);
  }

  private async doPush(groups: Record<string, GroupMapping>): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.authHeader) headers['Authorization'] = this.authHeader;

      const res = await fetch(`${this.endpoint}/groups`, {
        method: 'PUT',
        headers,
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
}
