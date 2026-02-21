import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
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

const RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class Logger extends EventEmitter {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private pruneTimer: ReturnType<typeof setInterval>;

  constructor(dbPath: string = './data/logs.db') {
    super();
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.init();
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO logs (id, timestamp, channel, from_jid, sender_name, text, type, group_id, group_name, webhook_url, response_text, status, latency_ms)
      VALUES (@id, @timestamp, @channel, @from_jid, @sender_name, @text, @type, @group_id, @group_name, @webhook_url, @response_text, @status, @latency_ms)
    `);
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        channel TEXT,
        from_jid TEXT,
        sender_name TEXT,
        text TEXT,
        type TEXT,
        group_id TEXT,
        group_name TEXT,
        webhook_url TEXT,
        response_text TEXT,
        status TEXT,
        latency_ms INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_channel ON logs(channel);
    `);
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
    const result = this.db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoff);
    if (result.changes > 0) {
      console.log(`[logger] Pruned ${result.changes} log entries older than ${RETENTION_DAYS} days`);
    }
  }

  log(entry: LogEntry): void {
    this.insertStmt.run({
      id: entry.id,
      timestamp: entry.timestamp,
      channel: entry.channel,
      from_jid: entry.from,
      sender_name: entry.senderName ?? null,
      text: entry.text ?? null,
      type: entry.type,
      group_id: entry.groupId ?? null,
      group_name: entry.groupName ?? null,
      webhook_url: entry.route ?? null,
      response_text: entry.responseText ?? null,
      status: entry.status,
      latency_ms: entry.latency ?? null,
    });
    this.emit('entry', entry);
  }

  private rowToEntry(row: any): LogEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      channel: row.channel,
      from: row.from_jid,
      senderName: row.sender_name,
      text: row.text,
      type: row.type,
      groupId: row.group_id,
      groupName: row.group_name,
      route: row.webhook_url,
      responseText: row.response_text,
      status: row.status,
      latency: row.latency_ms,
    };
  }

  getAll(): LogEntry[] {
    return this.db.prepare('SELECT * FROM logs ORDER BY timestamp DESC').all().map(this.rowToEntry);
  }

  search(query: { limit?: number; channel?: string; search?: string }): LogEntry[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (query.channel) {
      conditions.push('channel = ?');
      params.push(query.channel);
    }
    if (query.search) {
      conditions.push('(text LIKE ? OR from_jid LIKE ? OR sender_name LIKE ? OR response_text LIKE ?)');
      const q = `%${query.search}%`;
      params.push(q, q, q, q);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = query.limit ? `LIMIT ${query.limit}` : '';

    return this.db.prepare(`SELECT * FROM logs ${where} ORDER BY timestamp DESC ${limit}`).all(...params).map(this.rowToEntry);
  }

  getStats(): { total: number; byChannel: Record<string, number>; avgLatency: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM logs').get() as any).c;
    const channels = this.db.prepare('SELECT channel, COUNT(*) as c FROM logs GROUP BY channel').all() as any[];
    const byChannel: Record<string, number> = {};
    for (const row of channels) byChannel[row.channel] = row.c;
    const avg = (this.db.prepare('SELECT AVG(latency_ms) as a FROM logs WHERE latency_ms IS NOT NULL').get() as any).a;

    return { total, byChannel, avgLatency: Math.round(avg || 0) };
  }

  close(): void {
    clearInterval(this.pruneTimer);
    this.db.close();
  }
}
