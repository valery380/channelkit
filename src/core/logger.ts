import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { DEFAULT_DATA_DIR } from '../paths';

export interface HttpCallRecord {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
  };
}

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
  serviceName?: string;
  responseText?: string;
  status: 'success' | 'error' | 'no-route' | 'blocked' | 'format-error';
  latency?: number;
  sttTranscription?: string;
  sttError?: string;
  /** ISO 639-1 language code that STT detected (when auto-detection was used). */
  detectedLanguage?: string;
  /** Translation of the message text, when service.translate is configured. */
  translatedText?: string;
  /** ISO 639-1 target language for the translation. */
  translatedLanguage?: string;
  /** If translation failed, the error message. */
  translateError?: string;
  ttsGenerated?: boolean;
  formatApplied?: boolean;
  formatOriginalText?: string;
  httpCall?: HttpCallRecord;
}

const RETENTION_DAYS = 30;

export class Logger extends EventEmitter {
  private db: Database.Database;

  constructor(dataDir: string = DEFAULT_DATA_DIR) {
    super();
    const dbPath = join(dataDir, 'logs.db');
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
    this.cleanup();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        channel TEXT NOT NULL,
        from_jid TEXT NOT NULL,
        sender_name TEXT,
        text TEXT,
        type TEXT NOT NULL,
        group_id TEXT,
        group_name TEXT,
        webhook_url TEXT,
        response_text TEXT,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        stt_transcription TEXT,
        tts_generated INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_channel ON logs(channel);
    `);

    // Migration: add columns if they don't exist (for existing databases)
    try { this.db.exec('ALTER TABLE logs ADD COLUMN stt_transcription TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN tts_generated INTEGER'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN format_applied INTEGER'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN format_original_text TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN service_name TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN http_call TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN stt_error TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN detected_language TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN translated_text TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN translated_language TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE logs ADD COLUMN translate_error TEXT'); } catch {}
  }

  private cleanup(): void {
    const cutoff = Math.floor(Date.now() / 1000) - (RETENTION_DAYS * 86400);
    const result = this.db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoff);
    if (result.changes > 0) {
      console.log(`[logger] Cleaned up ${result.changes} log entries older than ${RETENTION_DAYS} days`);
    }
  }

  log(entry: LogEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO logs (id, timestamp, channel, from_jid, sender_name, text, type, group_id, group_name, webhook_url, response_text, status, latency_ms, stt_transcription, tts_generated, format_applied, format_original_text, service_name, http_call, stt_error, detected_language, translated_text, translated_language, translate_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.timestamp,
      entry.channel,
      entry.from,
      entry.senderName || null,
      entry.text || null,
      entry.type,
      entry.groupId || null,
      entry.groupName || null,
      entry.route || null,
      entry.responseText || null,
      entry.status,
      entry.latency ?? null,
      entry.sttTranscription || null,
      entry.ttsGenerated ? 1 : null,
      entry.formatApplied ? 1 : null,
      entry.formatOriginalText || null,
      entry.serviceName || null,
      entry.httpCall ? JSON.stringify(entry.httpCall) : null,
      entry.sttError || null,
      entry.detectedLanguage || null,
      entry.translatedText || null,
      entry.translatedLanguage || null,
      entry.translateError || null
    );
    this.emit('entry', entry);
  }

  clear(): void {
    this.db.prepare('DELETE FROM logs').run();
  }

  getAll(): LogEntry[] {
    return this.db.prepare(
      'SELECT * FROM logs ORDER BY timestamp DESC LIMIT 1000'
    ).all().map(this.rowToEntry);
  }

  search(query: {
    limit?: number;
    channel?: string;
    search?: string;
  }): LogEntry[] {
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit || 100;

    return this.db.prepare(
      `SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT ?`
    ).all(...params, limit).map(this.rowToEntry);
  }

  getStats(): { total: number; byChannel: Record<string, number>; avgLatency: number; errorCount: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM logs').get() as any).count;

    const channels = this.db.prepare(
      'SELECT channel, COUNT(*) as count FROM logs GROUP BY channel'
    ).all() as any[];
    const byChannel: Record<string, number> = {};
    for (const row of channels) {
      byChannel[row.channel] = row.count;
    }

    const avg = (this.db.prepare(
      'SELECT AVG(latency_ms) as avg FROM logs WHERE latency_ms IS NOT NULL'
    ).get() as any).avg;

    const errorCount = (this.db.prepare(
      "SELECT COUNT(*) as count FROM logs WHERE status = 'error'"
    ).get() as any).count;

    return {
      total,
      byChannel,
      avgLatency: Math.round(avg || 0),
      errorCount,
    };
  }

  private rowToEntry(row: any): LogEntry {
    let httpCall: HttpCallRecord | undefined;
    if (row.http_call) {
      try { httpCall = JSON.parse(row.http_call); } catch {}
    }
    return {
      id: row.id,
      timestamp: row.timestamp,
      channel: row.channel,
      from: row.from_jid,
      senderName: row.sender_name || undefined,
      text: row.text || undefined,
      type: row.type,
      groupId: row.group_id || undefined,
      groupName: row.group_name || undefined,
      route: row.webhook_url || undefined,
      serviceName: row.service_name || undefined,
      responseText: row.response_text || undefined,
      status: row.status,
      latency: row.latency_ms ?? undefined,
      sttTranscription: row.stt_transcription || undefined,
      sttError: row.stt_error || undefined,
      detectedLanguage: row.detected_language || undefined,
      translatedText: row.translated_text || undefined,
      translatedLanguage: row.translated_language || undefined,
      translateError: row.translate_error || undefined,
      ttsGenerated: row.tts_generated ? true : undefined,
      formatApplied: row.format_applied ? true : undefined,
      formatOriginalText: row.format_original_text || undefined,
      httpCall,
    };
  }
}
