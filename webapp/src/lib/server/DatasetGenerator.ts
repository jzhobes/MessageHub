import Database from 'better-sqlite3';
import { encoding_for_model, Tiktoken, TiktokenModel } from 'tiktoken';

import { sampleThreadDays } from '@/lib/server/dataset/sampleThreadDays';
import {
  DatasetCore,
  DatasetDataSource,
  DatasetRow,
  DatasetThreadMeta,
  GeneratedRecord,
  GeneratorOptions,
} from '@/lib/shared/dataset/DatasetCore';

export type { GeneratedRecord, GeneratorOptions };

function createSqliteDataSource(dbInstance: Database.Database): DatasetDataSource {
  return {
    getThread(threadId: string): DatasetThreadMeta | undefined {
      return dbInstance
        .prepare('SELECT is_group, platform, title, participants_json FROM threads WHERE id = ?')
        .get(threadId) as DatasetThreadMeta | undefined;
    },

    getThreadMessages(threadId: string, dateRange?: { start: number; end: number }): DatasetRow[] {
      const params: (string | number)[] = [threadId];
      let sql = `
        SELECT sender_name, content, timestamp_ms, media_json, reactions_json, share_json, annotations_json
        FROM content
        WHERE thread_id = ?
      `;
      if (dateRange) {
        sql += ' AND timestamp_ms BETWEEN ? AND ?';
        params.push(dateRange.start, dateRange.end);
      }
      sql += ' ORDER BY timestamp_ms ASC';
      return dbInstance.prepare(sql).all(...params) as DatasetRow[];
    },

    getPostMessages(dateRange?: { start: number; end: number }): DatasetRow[] {
      const params: (string | number)[] = [];
      let sql = `
        SELECT t.title as thread_title, m.sender_name, m.content, m.timestamp_ms,
               m.media_json, m.reactions_json, m.share_json, m.annotations_json
        FROM content m
        JOIN threads t ON m.thread_id = t.id
        JOIN thread_labels tl ON m.thread_id = tl.thread_id
        WHERE tl.label = 'post'
      `;
      if (dateRange) {
        sql += ' AND m.timestamp_ms BETWEEN ? AND ?';
        params.push(dateRange.start, dateRange.end);
      }
      sql += ' ORDER BY m.timestamp_ms ASC';
      return dbInstance.prepare(sql).all(...params) as DatasetRow[];
    },

    getEventMessages(statuses: string[], dateRange?: { start: number; end: number }): DatasetRow[] {
      const placeholders = statuses.map(() => '?').join(',');
      const params: (string | number)[] = [...statuses];
      let sql = `
        SELECT t.title as thread_title, m.sender_name, m.content, m.timestamp_ms,
               m.media_json, m.reactions_json, m.share_json, m.annotations_json
        FROM content m
        JOIN threads t ON m.thread_id = t.id
        JOIN thread_labels tl ON m.thread_id = tl.thread_id
        WHERE tl.label = 'event' AND m.content IN (${placeholders})
      `;
      if (dateRange) {
        sql += ' AND m.timestamp_ms BETWEEN ? AND ?';
        params.push(dateRange.start, dateRange.end);
      }
      sql += ' ORDER BY m.timestamp_ms ASC';
      return dbInstance.prepare(sql).all(...params) as DatasetRow[];
    },

    sampleThreadDays(threadId, identityNames, opts) {
      return sampleThreadDays(dbInstance, threadId, identityNames, opts);
    },
  };
}

export class DatasetGenerator {
  private _dbInstance: Database.Database | null = null;
  private _encoder: Tiktoken;
  private _core: DatasetCore;

  constructor(opts: GeneratorOptions) {
    // Database instance is provided after instantiation via setDb()
    this._encoder = encoding_for_model('gpt-4' as TiktokenModel);
    this._core = new DatasetCore({
      ...opts,
      countTokens: (text: string) => this._encoder.encode(text).length,
    });
  }

  public setDb(db: Database.Database) {
    this._dbInstance = db;
    this._core.setDataSource(createSqliteDataSource(db));
  }

  /**
   * Streams structured dataset records (training sessions and optional Markdown history)
   * without coupling consumers to file packaging. Requires `setDb()` to be called first.
   */
  public generateRecords(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<GeneratedRecord> {
    if (!this._dbInstance) {
      throw new Error('Database instance not set in DatasetGenerator');
    }
    return this._core.generateRecords(threadIds, identityNames, dateRange, onProgress);
  }

  /**
   * Streams formatted dataset files for the selected thread IDs.
   * Requires `setDb()` to be called first. Supports both database thread IDs and virtual Facebook IDs
   * (`fb-post-all`, `fb-event-*`). Splits chat sessions on 4-hour inactivity gaps or token limits,
   * pairs Gmail threads via `EmailPairBuilder`, and yields JSONL chunks bounded by `maxTokensPerFile`
   * (or consolidated ChatGPT Project Markdown files when `outputFormat === 'markdown'`).
   */
  public generateStream(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<{ fileName: string; content: string; tokenCount: number }> {
    if (!this._dbInstance) {
      throw new Error('Database instance not set in DatasetGenerator');
    }
    return this._core.generateStream(threadIds, identityNames, dateRange, onProgress);
  }
}
