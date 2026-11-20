import Database from 'better-sqlite3';

import { formatDateKey, isMarkdownSystemMessage } from '@/lib/server/dataset/builders/MarkdownExportBuilder';

export interface DaySummaryStat {
  date: string;
  totalMsgs: number;
  myMsgs: number;
  otherMsgs: number;
  uniqueSpeakers: number;
  reactionCount: number;
  avgMyLen: number;
  maxTs: number;
  score: number;
}

export interface ThreadDaySampleResult {
  selectedDays: string[];
  dayStats: Record<string, { totalMsgs: number; myMsgs: number }>;
  totalSelectedMsgs: number;
  isEvent?: boolean;
}

interface RawScanRow {
  sender_name: string | null;
  content: string | null;
  timestamp_ms: number;
  reactions_json: string | null;
}

const BIRTHDAY_REGEX = /^(happy birthday|hbd|happy bday|feliz cumple)/i;

function isMeSender(senderName: string | null, myNamesLower: Set<string>, myNamesList: string[]): boolean {
  if (!senderName) {
    return false;
  }
  const norm = senderName.toLowerCase().trim();
  if (!norm) {
    return false;
  }
  if (myNamesLower.has(norm)) {
    return true;
  }
  return myNamesList.some((myName) => myName.length >= 3 && (norm.includes(myName) || myName.includes(norm)));
}

function daysBetween(dateA: string, dateB: string): number {
  const msA = Date.parse(`${dateA}T00:00:00Z`);
  const msB = Date.parse(`${dateB}T00:00:00Z`);
  return Math.abs(msA - msB) / (24 * 60 * 60 * 1000);
}

/**
 * Scores eligible calendar days and picks a time-diverse set of days targeting
 * ~100 total messages (85–120 soft window).
 */
export function selectBestDays(
  days: DaySummaryStat[],
  opts: { isChat: boolean; isPost?: boolean; targetMessages?: number } = { isChat: true },
): string[] {
  const target = opts.targetMessages ?? 100;
  const softMin = Math.round(target * 0.85);
  const softMax = Math.round(target * 1.25);

  if (days.length === 0) {
    return [];
  }

  let eligible: DaySummaryStat[];
  if (opts.isChat) {
    eligible = days.filter((d) => d.myMsgs >= 2 && d.otherMsgs >= 2);
    if (eligible.length === 0) {
      eligible = days.filter((d) => d.myMsgs >= 1 && d.otherMsgs >= 1);
    }
    if (eligible.length === 0) {
      eligible = days.filter((d) => d.myMsgs >= 1);
    }
  } else {
    eligible = days.filter((d) => d.myMsgs >= 1);
  }

  if (eligible.length === 0) {
    return [];
  }

  const maxTs = Math.max(...eligible.map((d) => d.maxTs));
  const minTs = Math.min(...eligible.map((d) => d.maxTs));
  const tsSpan = Math.max(1, maxTs - minTs);

  for (const d of eligible) {
    if (opts.isChat) {
      // 1. Back-and-forth balance (up to 30 pts)
      const exchanges = Math.min(d.myMsgs, d.otherMsgs);
      const balanceScore = Math.min(30, (Math.sqrt(exchanges) / Math.sqrt(12)) * 30);

      // 2. Sweet-spot volume: peaks at 15–45 msgs/day (up to 25 pts)
      let volumeScore = 25;
      if (d.totalMsgs < 15) {
        volumeScore = (d.totalMsgs / 15) * 25;
      } else if (d.totalMsgs > 45) {
        volumeScore = Math.max(5, 25 - ((d.totalMsgs - 45) / 120) * 20);
      }

      // 3. Engagement & group dynamics (up to 20 pts)
      const reactionPts = Math.min(12, d.reactionCount * 2.5);
      const speakerPts = Math.min(8, Math.max(0, d.uniqueSpeakers - 1) * 3);
      const engagementScore = reactionPts + speakerPts;

      // 4. Substance (up to 15 pts)
      const substanceScore = Math.min(15, Math.max(0, Math.log(Math.max(1, d.avgMyLen)) * 3.5));

      // 5. Recency nudge (up to 10 pts)
      const recencyScore = ((d.maxTs - minTs) / tsSpan) * 10;

      d.score = balanceScore + volumeScore + engagementScore + substanceScore + recencyScore;
    } else {
      // Posts & Emails: favor substantive length + reactions + recency
      const substanceScore = Math.min(45, Math.max(0, Math.log(Math.max(1, d.avgMyLen)) * 9));
      const reactionPts = Math.min(20, d.reactionCount * 4);
      const volumePts = Math.min(15, Math.sqrt(d.totalMsgs) * 5);
      const recencyScore = ((d.maxTs - minTs) / tsSpan) * 20;
      d.score = substanceScore + reactionPts + volumePts + recencyScore;
    }
  }

  const sorted = [...eligible].sort((a, b) => b.score - a.score || b.maxTs - a.maxTs);
  const picked: DaySummaryStat[] = [];
  const pickedDates = new Set<string>();
  const pickedMonths = new Set<string>();
  let totalMsgs = 0;

  const tryPick = (requireDistinctMonth: boolean) => {
    for (const candidate of sorted) {
      if (totalMsgs >= softMin) {
        break;
      }
      if (pickedDates.has(candidate.date)) {
        continue;
      }
      const monthKey = candidate.date.slice(0, 7);
      if (requireDistinctMonth) {
        if (pickedMonths.has(monthKey)) {
          continue;
        }
        if (picked.some((p) => daysBetween(p.date, candidate.date) < 14)) {
          continue;
        }
      }
      // Avoid blowing far past softMax if we already have a decent sample
      if (totalMsgs >= Math.round(target * 0.6) && totalMsgs + candidate.totalMsgs > softMax) {
        continue;
      }

      picked.push(candidate);
      pickedDates.add(candidate.date);
      pickedMonths.add(monthKey);
      totalMsgs += candidate.totalMsgs;
    }
  };

  // Pass 1: Spread across distinct months / >= 14 days apart
  tryPick(true);
  // Pass 2: Fill remaining budget from any remaining high-scoring days
  if (totalMsgs < softMin) {
    tryPick(false);
  }
  // Pass 3: Always pick at least the single best day if nothing was picked
  if (picked.length === 0 && sorted.length > 0) {
    picked.push(sorted[0]);
  }

  // Return chronologically sorted (newest first for chip display, or oldest first)
  return picked.map((p) => p.date).sort();
}

/**
 * Aggregates per-day stats for a single thread in SQLite within `dateRange`
 * and selects a representative set of days targeting `targetMessages`.
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
  // Events are exported as a timeline without day slicing
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

  const myNamesLower = new Set(identityNames.map((n) => n.toLowerCase().trim()).filter(Boolean));
  const myNamesList = Array.from(myNamesLower);

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

  const dayMap = new Map<
    string,
    {
      totalMsgs: number;
      myMsgs: number;
      otherMsgs: number;
      speakers: Set<string>;
      reactionCount: number;
      myLenSum: number;
      maxTs: number;
    }
  >();

  for (const row of rows) {
    const text = (row.content || '').trim();
    if (isMarkdownSystemMessage(text)) {
      continue;
    }
    if (isPost) {
      if (!text || text === 'Post' || (BIRTHDAY_REGEX.test(text) && text.length < 20)) {
        continue;
      }
    }

    const dateKey = formatDateKey(row.timestamp_ms, opts.timeZone);
    let bucket = dayMap.get(dateKey);
    if (!bucket) {
      bucket = {
        totalMsgs: 0,
        myMsgs: 0,
        otherMsgs: 0,
        speakers: new Set<string>(),
        reactionCount: 0,
        myLenSum: 0,
        maxTs: row.timestamp_ms,
      };
      dayMap.set(dateKey, bucket);
    }

    bucket.totalMsgs++;
    if (row.timestamp_ms > bucket.maxTs) {
      bucket.maxTs = row.timestamp_ms;
    }
    if (row.sender_name) {
      bucket.speakers.add(row.sender_name.toLowerCase().trim());
    }
    if (row.reactions_json && row.reactions_json !== '[]') {
      try {
        const parsed = JSON.parse(row.reactions_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          bucket.reactionCount += parsed.length;
        }
      } catch {
        // ignore
      }
    }

    const isMe = isPost ? true : isMeSender(row.sender_name, myNamesLower, myNamesList);
    if (isMe) {
      bucket.myMsgs++;
      bucket.myLenSum += text.length;
    } else {
      bucket.otherMsgs++;
    }
  }

  const summaries: DaySummaryStat[] = [];
  const dayStats: Record<string, { totalMsgs: number; myMsgs: number }> = {};

  for (const [date, b] of dayMap.entries()) {
    dayStats[date] = { totalMsgs: b.totalMsgs, myMsgs: b.myMsgs };
    summaries.push({
      date,
      totalMsgs: b.totalMsgs,
      myMsgs: b.myMsgs,
      otherMsgs: b.otherMsgs,
      uniqueSpeakers: b.speakers.size,
      reactionCount: b.reactionCount,
      avgMyLen: b.myMsgs > 0 ? b.myLenSum / b.myMsgs : 0,
      maxTs: b.maxTs,
      score: 0,
    });
  }

  const selectedDays = selectBestDays(summaries, {
    isChat: !isPost && !isEmail,
    isPost,
    targetMessages: opts.targetMessages ?? (isPost ? 40 : isEmail ? 25 : 100),
  });

  const totalSelectedMsgs = selectedDays.reduce((sum, d) => sum + (dayStats[d]?.totalMsgs || 0), 0);

  return {
    selectedDays,
    dayStats,
    totalSelectedMsgs,
  };
}
