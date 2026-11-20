import Database from 'better-sqlite3';

import {
  DaySummaryStat,
  RawScanRow,
  sampleThreadRows,
  selectBestDays,
  ThreadDaySampleResult,
} from '@/lib/shared/dataset/sampleThreadDays';

export { sampleThreadRows, selectBestDays };
export type { DaySummaryStat, RawScanRow, ThreadDaySampleResult };

/**
 * Get daily stats for one thread from SQLite within `dateRange`, then pick representative days to
 * get close to `targetMessages`.
 */
export function sampleThreadDays(
  dbInstance: Database.Database,
  threadId: string,
  identityNames: string[],
  opts: {
    dateRange?: { start: number; end: number };
    timeZone?: string;
    targetMessages?: number;
  } = {},
): ThreadDaySampleResult {
  // Events get a full timeline, so skip day selection.
  if (threadId.startsWith('fb-event-')) {
    const cat = threadId.replace('fb-event-', '');
    const statuses = cat === 'owned' ? ['Created Event'] : ['Joined Event', 'Interested in Event'];
    const placeholders = statuses.map(() => '?').join(',');
    const params: (string | number)[] = [...statuses];
    let sql = `
      SELECT COUNT(*) as count
      FROM content c
      INNER JOIN thread_labels tl ON c.thread_id = tl.thread_id
      WHERE tl.label = 'event' AND c.content IN (${placeholders})
    `;
    if (opts.dateRange) {
      sql += ' AND c.timestamp_ms BETWEEN ? AND ?';
      params.push(opts.dateRange.start, opts.dateRange.end);
    }
    const row = dbInstance.prepare(sql).get(...params) as { count: number };
    return {
      selectedDays: [],
      dayStats: {},
      totalSelectedMsgs: row?.count || 0,
      isEvent: true,
    };
  }

  let isPost = false;
  let isEmail = false;
  let rows: RawScanRow[] = [];

  if (threadId === 'fb-post-all') {
    isPost = true;
    const params: (string | number)[] = [];
    let sql = `
      SELECT m.sender_name, m.content, m.timestamp_ms, m.reactions_json
      FROM content m
      JOIN thread_labels tl ON m.thread_id = tl.thread_id
      WHERE tl.label = 'post'
    `;
    if (opts.dateRange) {
      sql += ' AND m.timestamp_ms BETWEEN ? AND ?';
      params.push(opts.dateRange.start, opts.dateRange.end);
    }
    sql += ' ORDER BY m.timestamp_ms ASC';
    rows = dbInstance.prepare(sql).all(...params) as RawScanRow[];
  } else {
    const thread = dbInstance.prepare('SELECT platform FROM threads WHERE id = ?').get(threadId) as
      { platform: string } | undefined;
    isEmail = thread?.platform === 'google_mail' || thread?.platform === 'gmail';

    const params: (string | number)[] = [threadId];
    let sql = `
      SELECT sender_name, content, timestamp_ms, reactions_json
      FROM content
      WHERE thread_id = ?
    `;
    if (opts.dateRange) {
      sql += ' AND timestamp_ms BETWEEN ? AND ?';
      params.push(opts.dateRange.start, opts.dateRange.end);
    }
    sql += ' ORDER BY timestamp_ms ASC';
    rows = dbInstance.prepare(sql).all(...params) as RawScanRow[];
  }

  return sampleThreadRows(rows, identityNames, {
    isPost,
    isEmail,
    timeZone: opts.timeZone,
    targetMessages: opts.targetMessages,
  });
}
