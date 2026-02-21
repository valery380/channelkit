import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { EventEmitter } from 'events';

export interface LogEntry {
  id: string;
  timestamp: number;
  channel: string;
  from: string;
  senderName?: string;
  text?: string;
  type: string;
  groupId?: string;
  groupName?: string;
  route?: string;
  responseText?: string;
  status: 'success' | 'error' | 'no-route';
  latency?: number;
}

const MAX_ENTRIES = 1000;

export class Logger extends EventEmitter {
  private entries: LogEntry[] = [];
  private filePath: string;

  constructor(dataDir: string = './data') {
    super();
    this.filePath = join(dataDir, 'logs.json');
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        this.entries = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  log(entry: LogEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
    this.save();
    this.emit('entry', entry);
  }

  getAll(): LogEntry[] {
    return this.entries;
  }

  search(query: {
    limit?: number;
    channel?: string;
    search?: string;
  }): LogEntry[] {
    let results = this.entries;

    if (query.channel) {
      results = results.filter(e => e.channel === query.channel);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      results = results.filter(e =>
        (e.text || '').toLowerCase().includes(q) ||
        (e.from || '').toLowerCase().includes(q) ||
        (e.senderName || '').toLowerCase().includes(q) ||
        (e.responseText || '').toLowerCase().includes(q)
      );
    }
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  getStats(): { total: number; byChannel: Record<string, number>; avgLatency: number } {
    const byChannel: Record<string, number> = {};
    let totalLatency = 0;
    let latencyCount = 0;

    for (const e of this.entries) {
      byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
      if (e.latency != null) {
        totalLatency += e.latency;
        latencyCount++;
      }
    }

    return {
      total: this.entries.length,
      byChannel,
      avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
    };
  }
}
