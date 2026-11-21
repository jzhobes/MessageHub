import JSZip from 'jszip';

import { getFileExtension, RawContentRow, transformContentRows } from '@/lib/shared/contentTransform';
import { formatDateKey } from '@/lib/shared/dataset/builders/MarkdownExportBuilder';
import { DatasetCore, DatasetDataSource, DatasetRow, DatasetThreadMeta } from '@/lib/shared/dataset/DatasetCore';
import { RawScanRow, sampleThreadRows, ThreadDaySampleResult } from '@/lib/shared/dataset/sampleThreadDays';
import { getPlatformDbValue, PlatformMap, ReversePlatformMap } from '@/lib/shared/platforms';
import { parseSearchQuery } from '@/lib/shared/search';
import { containsHtmlOrEntities, generateContextSnippet, stripHtml, stripUrls } from '@/lib/shared/stringUtils';
import { inferThreadTitle } from '@/lib/shared/threadUtils';
import { DatasetEntry } from '@/lib/shared/types';

import { loadDemoData } from './demoStore';

import type { DemoStore } from './demoStore';
import type { DemoContentRow } from './demoTypes';

const PAGE_SIZE = 100;

interface DemoJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  blob?: Blob;
  blobUrl?: string;
  error?: string;
}

const demoJobs = new Map<string, DemoJob>();

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    throw err;
  }
}

function messageTimestampBounds(rows: DemoContentRow[]) {
  let firstMessageTimestamp: number | null = null;
  let lastMessageTimestamp: number | null = null;
  for (const { timestamp_ms } of rows) {
    if (timestamp_ms != null) {
      firstMessageTimestamp = Math.min(firstMessageTimestamp ?? timestamp_ms, timestamp_ms);
      lastMessageTimestamp = Math.max(lastMessageTimestamp ?? timestamp_ms, timestamp_ms);
    }
  }
  return { firstMessageTimestamp, lastMessageTimestamp };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseJsonBody<T>(init?: RequestInit): T {
  if (!init?.body || typeof init.body !== 'string') {
    return {} as T;
  }
  return JSON.parse(init.body) as T;
}

function getAllQueryValues(searchParams: URLSearchParams, key: string): string[] {
  return searchParams.getAll(key).filter(Boolean);
}

function createDemoDataSource(store: DemoStore): DatasetDataSource {
  return {
    getThread(threadId: string): DatasetThreadMeta | undefined {
      const t = store.threadsById.get(threadId);
      if (!t) {
        return undefined;
      }
      return {
        is_group: t.is_group ? 1 : 0,
        platform: t.platform,
        title: t.title,
        participants_json: t.participants_json,
      };
    },

    getThreadMessages(threadId: string, dateRange?: { start: number; end: number }): DatasetRow[] {
      const desc = store.contentByThread.get(threadId) || [];
      const asc = [...desc].sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.id - b.id);
      return asc.filter((r) => !dateRange || (r.timestamp_ms >= dateRange.start && r.timestamp_ms <= dateRange.end));
    },

    getPostMessages(dateRange?: { start: number; end: number }): DatasetRow[] {
      const rows: DatasetRow[] = [];
      for (const row of store.data.content) {
        if (!store.labelsByThread.get(row.thread_id)?.has('post')) {
          continue;
        }
        if (dateRange && (row.timestamp_ms < dateRange.start || row.timestamp_ms > dateRange.end)) {
          continue;
        }
        rows.push({
          ...row,
          thread_title: store.threadsById.get(row.thread_id)?.title ?? undefined,
        });
      }
      rows.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
      return rows;
    },

    getEventMessages(statuses: string[], dateRange?: { start: number; end: number }): DatasetRow[] {
      const statusSet = new Set(statuses);
      const rows: DatasetRow[] = [];
      for (const row of store.data.content) {
        if (!store.labelsByThread.get(row.thread_id)?.has('event')) {
          continue;
        }
        if (!row.content || !statusSet.has(row.content)) {
          continue;
        }
        if (dateRange && (row.timestamp_ms < dateRange.start || row.timestamp_ms > dateRange.end)) {
          continue;
        }
        rows.push({
          ...row,
          thread_title: store.threadsById.get(row.thread_id)?.title ?? undefined,
        });
      }
      rows.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
      return rows;
    },

    sampleThreadDays(
      threadId: string,
      identityNames: string[],
      opts: { dateRange?: { start: number; end: number }; timeZone?: string; targetMessages?: number },
    ): ThreadDaySampleResult {
      return sampleThreadInStore(store, threadId, identityNames, opts);
    },
  };
}

function sampleThreadInStore(
  store: DemoStore,
  threadId: string,
  identityNames: string[],
  opts: { dateRange?: { start: number; end: number }; timeZone?: string; targetMessages?: number } = {},
): ThreadDaySampleResult {
  if (threadId.startsWith('fb-event-')) {
    const cat = threadId.replace('fb-event-', '');
    const statuses = new Set(cat === 'owned' ? ['Created Event'] : ['Joined Event', 'Interested in Event']);
    let count = 0;
    for (const row of store.data.content) {
      if (!store.labelsByThread.get(row.thread_id)?.has('event')) {
        continue;
      }
      if (!row.content || !statuses.has(row.content)) {
        continue;
      }
      if (opts.dateRange && (row.timestamp_ms < opts.dateRange.start || row.timestamp_ms > opts.dateRange.end)) {
        continue;
      }
      count++;
    }
    return {
      selectedDays: [],
      dayStats: {},
      totalSelectedMsgs: count,
      isEvent: true,
    };
  }

  let isPost = false;
  let isEmail = false;
  let rows: RawScanRow[] = [];

  if (threadId === 'fb-post-all') {
    isPost = true;
    rows = store.data.content
      .filter((row) => {
        if (!store.labelsByThread.get(row.thread_id)?.has('post')) {
          return false;
        }
        if (opts.dateRange && (row.timestamp_ms < opts.dateRange.start || row.timestamp_ms > opts.dateRange.end)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  } else {
    const thread = store.threadsById.get(threadId);
    isEmail = thread?.platform === 'google_mail' || thread?.platform === 'gmail';
    const desc = store.contentByThread.get(threadId) || [];
    rows = [...desc]
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.id - b.id)
      .filter(
        (row) =>
          !opts.dateRange || (row.timestamp_ms >= opts.dateRange.start && row.timestamp_ms <= opts.dateRange.end),
      );
  }

  return sampleThreadRows(rows, identityNames, {
    isPost,
    isEmail,
    timeZone: opts.timeZone,
    targetMessages: opts.targetMessages,
  });
}

function handleStatus(store: DemoStore): Response {
  const status: Record<string, boolean> = {};
  Object.keys(PlatformMap).forEach((dbKey) => {
    status[dbKey] = store.data.threads.some((t) => t.platform === dbKey);
  });
  return jsonResponse({ initialized: true, platforms: status });
}

function handleThreads(store: DemoStore, url: URL): Response {
  const platformInputs = getAllQueryValues(url.searchParams, 'platform');
  const validDbPlatforms = platformInputs.map(getPlatformDbValue).filter(Boolean);
  const type = url.searchParams.get('type') || undefined;

  const counts: Record<string, number> = {
    message: 0,
    event: 0,
    post: 0,
    checkin: 0,
    inbox: 0,
    sent: 0,
  };

  if (validDbPlatforms.length > 0) {
    const platformSet = new Set(validDbPlatforms);
    for (const tl of store.data.thread_labels) {
      const t = store.threadsById.get(tl.thread_id);
      if (t && platformSet.has(t.platform)) {
        counts[tl.label] = (counts[tl.label] || 0) + 1;
      }
    }
  }

  if (validDbPlatforms.includes('facebook') && type === 'event') {
    const eventCats = [
      { id: 'fb-event-owned', title: 'Your Events', status: 'Created Event' },
      { id: 'fb-event-joined', title: 'Joined Events', status: 'Joined Event' },
      { id: 'fb-event-interested', title: 'Events Interested In', status: 'Interested in Event' },
      { id: 'fb-event-declined', title: 'Declined Events', status: 'Declined Event' },
    ];

    const virtualThreads = eventCats.map((cat) => {
      const matching = store.data.content.filter(
        (c) => store.labelsByThread.get(c.thread_id)?.has('event') && c.content === cat.status,
      );
      const lastTs = matching.reduce((max, c) => Math.max(max, c.timestamp_ms), 0);
      let snippet = 'No events';
      if (lastTs > 0) {
        const latest = matching.find((c) => c.timestamp_ms === lastTs);
        const latestTitle = latest ? store.threadsById.get(latest.thread_id)?.title : undefined;
        snippet = `Latest: ${latestTitle || 'Unknown Event'}`;
      }
      return {
        id: cat.id,
        platform: 'facebook',
        title: cat.title,
        timestamp: lastTs,
        ...messageTimestampBounds(matching),
        snippet,
        pageCount: Math.ceil(matching.length / PAGE_SIZE),
      };
    });

    return jsonResponse({ threads: virtualThreads, counts });
  }

  if (validDbPlatforms.includes('facebook') && (type === 'post' || type === 'checkin')) {
    const matchingThreads = store.data.threads.filter(
      (t) => t.platform === 'facebook' && store.labelsByThread.get(t.id)?.has(type),
    );
    const lastTs = matchingThreads.reduce((max, t) => Math.max(max, t.last_activity_ms ?? 0), 0);
    const title = type === 'post' ? 'My Posts' : 'My Check-ins';
    const snippet = `Browse all ${matchingThreads.length.toLocaleString()} ${type === 'post' ? 'posts' : 'check-ins'}`;
    return jsonResponse({
      threads: [
        {
          id: `fb-${type}-all`,
          platform: 'facebook',
          title,
          timestamp: lastTs,
          ...messageTimestampBounds(matchingThreads.flatMap((t) => store.contentByThread.get(t.id) ?? [])),
          snippet,
          pageCount: Math.ceil(matchingThreads.length / PAGE_SIZE),
        },
      ],
      counts,
    });
  }

  const platformSet = validDbPlatforms.length > 0 ? new Set(validDbPlatforms) : null;
  const filtered = store.data.threads
    .filter((t) => {
      if (platformSet && !platformSet.has(t.platform)) {
        return false;
      }
      if (type && type !== 'all') {
        return !!store.labelsByThread.get(t.id)?.has(type);
      }
      return true;
    })
    .sort((a, b) => (b.last_activity_ms ?? 0) - (a.last_activity_ms ?? 0));

  const threads = filtered.map((row) => {
    const participants: string[] = JSON.parse(row.participants_json || '[]');
    const title = inferThreadTitle(row.title, participants, store.myNames);
    const msgCount = store.contentByThread.get(row.id)?.length ?? 0;
    return {
      id: row.id,
      ...(row.archived ? { archived: true } : {}),
      platform: row.platform,
      title: title || 'Untitled',
      participants,
      timestamp: row.last_activity_ms ?? 0,
      firstMessageTimestamp: store.contentByThread.get(row.id)?.at(-1)?.timestamp_ms ?? null,
      lastMessageTimestamp: store.contentByThread.get(row.id)?.at(0)?.timestamp_ms ?? null,
      snippet: row.snippet ?? '',
      ...(row.e2ee_cutover ? { e2eeCutover: true } : {}),
      pageCount: Math.ceil(msgCount / PAGE_SIZE),
    };
  });

  return jsonResponse({ threads, counts });
}

function handleContent(store: DemoStore, url: URL): Response {
  const threadId = url.searchParams.get('threadId');
  if (!threadId) {
    return jsonResponse({ error: 'Missing threadId' }, 400);
  }

  const pageNum = parseInt(url.searchParams.get('page') || '1', 10) || 1;
  const offset = (pageNum - 1) * PAGE_SIZE;

  let rows: RawContentRow[] = [];

  if (threadId.startsWith('fb-event-') || threadId === 'fb-post-all' || threadId === 'fb-checkin-all') {
    const catMap: Record<string, string | null> = {
      'fb-event-owned': 'Created Event',
      'fb-event-joined': 'Joined Event',
      'fb-event-interested': 'Interested in Event',
      'fb-event-declined': 'Declined Event',
      'fb-post-all': null,
      'fb-checkin-all': null,
    };
    const label = threadId.includes('post') ? 'post' : threadId.includes('checkin') ? 'checkin' : 'event';
    const statusValue = catMap[threadId];

    const groupedByTs = new Map<number, RawContentRow>();
    const matching = store.data.content
      .filter((c) => {
        if (!store.labelsByThread.get(c.thread_id)?.has(label)) {
          return false;
        }
        if (threadId.startsWith('fb-event-') && c.content !== statusValue) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms || b.id - a.id);

    for (const c of matching) {
      if (!groupedByTs.has(c.timestamp_ms)) {
        groupedByTs.set(c.timestamp_ms, {
          ...c,
          event_title: store.threadsById.get(c.thread_id)?.title ?? undefined,
        });
      }
    }

    rows = Array.from(groupedByTs.values()).slice(offset, offset + PAGE_SIZE);
  } else {
    let list = store.contentByThread.get(threadId) || [];
    if (threadId.startsWith('fb_event_')) {
      const seen = new Set<number>();
      list = list.filter((c) => {
        if (seen.has(c.timestamp_ms)) {
          return false;
        }
        seen.add(c.timestamp_ms);
        return true;
      });
    }
    rows = list.slice(offset, offset + PAGE_SIZE);
  }

  const records = transformContentRows(rows, store.myNames, threadId);
  return jsonResponse({ records });
}

function handleJump(store: DemoStore, url: URL): Response {
  const messageIdParam = url.searchParams.get('messageId');
  const queryThreadId = url.searchParams.get('threadId');
  const queryDate = url.searchParams.get('date');
  const queryTimeZone = url.searchParams.get('timeZone') || undefined;

  // Jump to a calendar day in a thread (YYYY-MM-DD).
  if (!messageIdParam && queryThreadId && queryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      return jsonResponse({ error: 'Invalid date format. Expected YYYY-MM-DD.' }, 400);
    }

    const approxCenterMs = Date.parse(`${queryDate}T12:00:00Z`);

    if (queryThreadId === 'fb-post-all') {
      const postAsc = store.data.content
        .filter((c) => store.labelsByThread.get(c.thread_id)?.has('post'))
        .sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.id - b.id);

      let target = postAsc.find((c) => formatDateKey(c.timestamp_ms, queryTimeZone) === queryDate);
      if (!target && postAsc.length > 0) {
        target = postAsc.reduce((best, cur) =>
          Math.abs(cur.timestamp_ms - approxCenterMs) < Math.abs(best.timestamp_ms - approxCenterMs) ? cur : best,
        );
      }
      if (!target) {
        return jsonResponse({ error: 'No messages found in thread' }, 404);
      }

      const newerTimestamps = new Set(
        postAsc.filter((c) => c.timestamp_ms > target!.timestamp_ms).map((c) => c.timestamp_ms),
      );
      const page = Math.ceil((newerTimestamps.size + 1) / PAGE_SIZE);
      return jsonResponse({
        threadId: queryThreadId,
        platform: 'facebook',
        page,
        timestamp: target.timestamp_ms,
        messageId: target.id,
        matchedDate: formatDateKey(target.timestamp_ms, queryTimeZone),
      });
    }

    const threadAsc = [...(store.contentByThread.get(queryThreadId) || [])].sort(
      (a, b) => a.timestamp_ms - b.timestamp_ms || a.id - b.id,
    );
    let target = threadAsc.find((c) => formatDateKey(c.timestamp_ms, queryTimeZone) === queryDate);
    if (!target && threadAsc.length > 0) {
      target = threadAsc.reduce((best, cur) =>
        Math.abs(cur.timestamp_ms - approxCenterMs) < Math.abs(best.timestamp_ms - approxCenterMs) ? cur : best,
      );
    }
    if (!target) {
      return jsonResponse({ error: 'No messages found in thread' }, 404);
    }

    const newerCount = threadAsc.filter(
      (c) => c.timestamp_ms > target!.timestamp_ms || (c.timestamp_ms === target!.timestamp_ms && c.id > target!.id),
    ).length;
    const page = Math.ceil((newerCount + 1) / PAGE_SIZE);
    const threadRow = store.threadsById.get(queryThreadId);

    return jsonResponse({
      threadId: queryThreadId,
      platform: threadRow?.platform || '',
      page,
      timestamp: target.timestamp_ms,
      messageId: target.id,
      matchedDate: formatDateKey(target.timestamp_ms, queryTimeZone),
    });
  }

  // Jump directly to a message ID.
  if (!messageIdParam) {
    return jsonResponse({ error: 'Missing messageId' }, 400);
  }

  const msgIdNum = Number(messageIdParam);
  const record = store.contentById.get(msgIdNum);
  if (!record) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const threadMessages = store.contentByThread.get(record.thread_id) || [];
  const newerCount = threadMessages.filter(
    (c) => c.timestamp_ms > record.timestamp_ms || (c.timestamp_ms === record.timestamp_ms && c.id > record.id),
  ).length;
  let rank = newerCount + 1;

  const thread = store.threadsById.get(record.thread_id);
  const labels = Array.from(store.labelsByThread.get(record.thread_id) || []);
  const category = labels.includes('message') ? 'message' : labels.includes('inbox') ? 'inbox' : labels[0] || 'message';

  let threadId = record.thread_id;

  if (category === 'post') {
    threadId = 'fb-post-all';
    const newerTs = new Set(
      store.data.content
        .filter((c) => store.labelsByThread.get(c.thread_id)?.has('post') && c.timestamp_ms > record.timestamp_ms)
        .map((c) => c.timestamp_ms),
    );
    rank = newerTs.size + 1;
  } else if (category === 'checkin') {
    threadId = 'fb-checkin-all';
    const newerTs = new Set(
      store.data.content
        .filter((c) => store.labelsByThread.get(c.thread_id)?.has('checkin') && c.timestamp_ms > record.timestamp_ms)
        .map((c) => c.timestamp_ms),
    );
    rank = newerTs.size + 1;
  } else if (category === 'event') {
    const eventStatus = record.content;
    if (eventStatus === 'Created Event') {
      threadId = 'fb-event-owned';
    } else if (eventStatus === 'Joined Event') {
      threadId = 'fb-event-joined';
    } else if (eventStatus === 'Interested in Event') {
      threadId = 'fb-event-interested';
    } else if (eventStatus === 'Declined Event') {
      threadId = 'fb-event-declined';
    }

    if (threadId.startsWith('fb-event-')) {
      const newerTs = new Set(
        store.data.content
          .filter(
            (c) =>
              store.labelsByThread.get(c.thread_id)?.has('event') &&
              c.content === eventStatus &&
              c.timestamp_ms > record.timestamp_ms,
          )
          .map((c) => c.timestamp_ms),
      );
      rank = newerTs.size + 1;
    }
  }

  return jsonResponse({
    threadId,
    platform: thread?.platform || '',
    page: Math.ceil(rank / PAGE_SIZE),
    timestamp: record.timestamp_ms,
    category,
  });
}

function handleSearch(store: DemoStore, url: URL): Response {
  const q = url.searchParams.get('q');
  if (!q) {
    return jsonResponse({ error: 'Missing search query' }, 400);
  }

  const pageNum = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;
  const includeFacetsParam = url.searchParams.get('includeFacets');
  const includeFacets = includeFacetsParam !== '0' && includeFacetsParam !== 'false';

  const { orGroups } = parseSearchQuery(q);
  if (orGroups.length === 0) {
    return jsonResponse({
      data: [],
      total: 0,
      ...(includeFacets ? { facets: { platforms: {}, categories: {}, senders: {} } } : {}),
    });
  }

  const platformInputs = getAllQueryValues(url.searchParams, 'platform');
  const validDbPlatforms = platformInputs.reduce((acc, raw) => {
    const dbValue = ReversePlatformMap[raw] || (PlatformMap[raw] ? raw : null);
    if (dbValue) {
      acc.push(dbValue);
    }
    return acc;
  }, [] as string[]);
  const platformSet = validDbPlatforms.length > 0 ? new Set(validDbPlatforms) : null;

  const validCategories = getAllQueryValues(url.searchParams, 'type');
  const categorySet = validCategories.length > 0 ? new Set(validCategories) : null;

  const validThreadIds = getAllQueryValues(url.searchParams, 'threadId');
  const threadSet = validThreadIds.length > 0 ? new Set(validThreadIds) : null;

  const compiledOrGroups = orGroups.map((tokens) => tokens.map((t) => new RegExp(t.regexPattern, 'i')));

  interface MatchedRow {
    row: DemoContentRow;
    platform: string;
    threadTitle: string | null;
    matchesPlatform: boolean;
    matchesCategory: boolean;
  }

  const baseMatches: MatchedRow[] = [];

  for (const row of store.data.content) {
    if (threadSet && !threadSet.has(row.thread_id)) {
      continue;
    }

    const thread = store.threadsById.get(row.thread_id);
    if (!thread) {
      continue;
    }

    const labels = store.labelsByThread.get(row.thread_id);
    const matchesPlatform = !platformSet || platformSet.has(thread.platform);
    const matchesCategory = !categorySet || (!!labels && Array.from(labels).some((l) => categorySet.has(l)));

    if (!includeFacets && (!matchesPlatform || !matchesCategory)) {
      continue;
    }

    const contentText = row.content || '';
    const titleText = thread.title || '';
    const senderText = row.sender_name || '';

    const matchesText = compiledOrGroups.some((andRegexes) =>
      andRegexes.every((re) => re.test(contentText) || re.test(titleText) || re.test(senderText)),
    );
    if (!matchesText) {
      continue;
    }

    baseMatches.push({
      row,
      platform: thread.platform,
      threadTitle: thread.title,
      matchesPlatform,
      matchesCategory,
    });
  }

  const platforms: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const senderCounts = new Map<string, number>();

  const fullyMatched = baseMatches.filter((m) => m.matchesPlatform && m.matchesCategory);
  fullyMatched.sort((a, b) => b.row.timestamp_ms - a.row.timestamp_ms || a.row.id - b.row.id);

  if (includeFacets) {
    for (const m of baseMatches) {
      if (m.matchesCategory) {
        platforms[m.platform] = (platforms[m.platform] || 0) + 1;
      }
      if (m.matchesPlatform) {
        const labels = store.labelsByThread.get(m.row.thread_id);
        if (labels) {
          for (const l of labels) {
            if (l) {
              categories[l] = (categories[l] || 0) + 1;
            }
          }
        }
      }
    }

    for (const m of fullyMatched) {
      const sender = m.row.sender_name || 'Unknown';
      senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
    }
  }

  let sortedSenders: Record<string, number> = {};
  if (includeFacets && senderCounts.size > 0) {
    const top20 = Array.from(senderCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const myNamesSet = new Set(store.myNames.map((n) => n.toLowerCase()));
    const humanReadable = store.myNames.filter((n) => !n.includes('@') && !n.startsWith('+'));
    const meDisplayName =
      (humanReadable.length > 0
        ? [...humanReadable].sort((a, b) => b.length - a.length)[0]
        : [...store.myNames].sort((a, b) => b.length - a.length)[0]) || 'Me';

    const senders: Record<string, number> = {};
    let meCount = 0;
    for (const [name, count] of top20) {
      if (myNamesSet.has(name.toLowerCase())) {
        meCount += count;
      } else {
        senders[name] = (senders[name] || 0) + count;
      }
    }
    if (meCount > 0) {
      senders[meDisplayName] = meCount;
    }
    sortedSenders = Object.fromEntries(Object.entries(senders).sort((a, b) => b[1] - a[1]));
  }

  const pageRows = fullyMatched.slice(offset, offset + PAGE_SIZE);
  const results = pageRows.map(({ row, platform, threadTitle }) => {
    let snippet = row.content || '';
    if (platform === 'google_mail' || snippet.includes('<') || snippet.includes('&')) {
      snippet = stripHtml(snippet);
    }
    snippet = generateContextSnippet(snippet, q, 300);

    return {
      message_id: row.id,
      thread_id: row.thread_id,
      thread_title: threadTitle,
      platform,
      sender_name: row.sender_name,
      timestamp: row.timestamp_ms,
      content: row.content,
      snippet,
    };
  });

  return jsonResponse({
    data: results,
    total: fullyMatched.length,
    ...(includeFacets
      ? {
          facets: {
            platforms,
            categories,
            senders: sortedSenders,
          },
        }
      : {}),
  });
}

function handleMediaGallery(store: DemoStore, url: URL): Response {
  const threadId = url.searchParams.get('threadId');
  if (!threadId) {
    return jsonResponse({ error: 'Thread ID is required' }, 400);
  }

  const rows = store.contentByThread.get(threadId) || [];
  const media: Array<{
    messageId: number;
    threadId: string;
    timestamp: number;
    mediaUrl: string;
    mediaType: 'photo' | 'video' | 'gif' | 'sticker';
    thumbnailUrl?: string;
  }> = [];

  for (const row of rows) {
    if (!row.media_json) {
      continue;
    }
    try {
      const mediaArray = JSON.parse(row.media_json);
      if (Array.isArray(mediaArray)) {
        mediaArray.forEach((item: { type: string; uri: string; thumbnail_uri?: string }) => {
          let actualType = item.type;
          if (actualType === 'file' && item.uri) {
            const ext = getFileExtension(item.uri);
            if (['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext)) {
              actualType = 'photo';
            } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
              actualType = 'video';
            } else if (ext === '.gif') {
              actualType = 'gif';
            }
          }
          if (['photo', 'video', 'gif', 'sticker'].includes(actualType)) {
            media.push({
              messageId: row.id,
              threadId: row.thread_id,
              timestamp: row.timestamp_ms,
              mediaUrl: item.uri,
              mediaType: actualType as 'photo' | 'video' | 'gif' | 'sticker',
              thumbnailUrl: item.thumbnail_uri,
            });
          }
        });
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return jsonResponse({ media, total: media.length });
}

function handleDatasetThreads(store: DemoStore, url: URL): Response {
  const platformStr = url.searchParams.get('platform') || undefined;
  const myNamesSet = new Set(store.myNames);
  const allowedLabels = new Set(['message', 'inbox', 'sent']);
  const TWO_YEARS = 63113904000;
  const now = Date.now();

  const threadsWithScore = store.data.threads
    .filter((t) => {
      const labels = store.labelsByThread.get(t.id);
      if (!labels || !Array.from(labels).some((l) => allowedLabels.has(l))) {
        return false;
      }
      if (platformStr && platformStr !== 'all' && t.platform !== platformStr) {
        return false;
      }
      return (store.contentByThread.get(t.id)?.length || 0) > 0;
    })
    .map((t) => {
      const msgs = store.contentByThread.get(t.id) || [];
      const total = msgs.length;
      let myCount = 0;
      let myLenSum = 0;
      for (const m of msgs) {
        if (myNamesSet.has(m.sender_name) && m.content && !m.content.startsWith('http')) {
          myCount++;
          // Match SQLite LENGTH(), which counts Unicode code points.
          myLenSum += Array.from(m.content).length;
        }
      }
      const avgLen = myCount > 0 ? myLenSum / myCount : 0;
      const participants: string[] = JSON.parse(t.participants_json || '[]');
      const title = inferThreadTitle(t.title, participants, store.myNames);
      const ratio = myCount / (total || 1);

      const timestamp = t.last_activity_ms ?? 0;
      const age = now - timestamp;
      const recencyScore = Math.max(0, 20 * (1 - age / TWO_YEARS));
      const participationScore = Math.min(ratio * 30, 30);
      const logLen = Math.log(avgLen || 1);
      const substanceScore = Math.min(Math.max(0, logLen * 6), 25);
      const volumeScore = Math.min(Math.sqrt(myCount) * 3, 25);

      let finalScore = recencyScore + participationScore + substanceScore + volumeScore;
      if (myCount < 5) {
        finalScore = 0;
      }

      return {
        id: t.id,
        title: title || 'Untitled',
        platform: t.platform,
        timestamp,
        firstMessageTimestamp: msgs.at(-1)?.timestamp_ms ?? null,
        lastMessageTimestamp: msgs.at(0)?.timestamp_ms ?? null,
        is_group: !!t.is_group,
        pageCount: 1,
        type: 'message',
        messageCount: total,
        myMessageCount: myCount,
        participationRatio: ratio,
        myAvgMessageLength: Math.round(avgLen),
        qualityScore: Math.round(finalScore),
      };
    });

  if (!platformStr || platformStr === 'all' || platformStr === 'facebook') {
    const allPosts = store.data.content.filter((m) => {
      const thread = store.threadsById.get(m.thread_id);
      return thread?.platform === 'facebook' && store.labelsByThread.get(m.thread_id)?.has('post');
    });
    const postMsgs = allPosts.filter((m) => m.content && !m.content.startsWith('http'));
    if (postMsgs.length > 0) {
      const lastTs = postMsgs.reduce((max, m) => {
        const ts = store.threadsById.get(m.thread_id)?.last_activity_ms ?? 0;
        return Math.max(max, ts);
      }, 0);
      const avgLen = postMsgs.reduce((sum, m) => sum + Array.from(m.content ?? '').length, 0) / postMsgs.length;
      const score = Math.min(
        Math.max(0, 20 * (1 - (now - lastTs) / TWO_YEARS)) +
          30 +
          Math.min(Math.log(avgLen || 1) * 6, 25) +
          Math.min(Math.sqrt(postMsgs.length) * 3, 25),
        100,
      );
      threadsWithScore.push({
        id: 'fb-post-all',
        title: 'My Posts',
        platform: 'facebook',
        timestamp: lastTs,
        ...messageTimestampBounds(allPosts),
        is_group: false,
        pageCount: 1,
        type: 'post',
        messageCount: postMsgs.length,
        myMessageCount: postMsgs.length,
        participationRatio: 1,
        myAvgMessageLength: Math.round(avgLen),
        qualityScore: Math.round(score),
      });
    }

    const eventCats = [
      { id: 'fb-event-owned', title: 'Your Events', status: new Set(['Created Event']) },
      { id: 'fb-event-joined', title: 'Joined Events', status: new Set(['Joined Event', 'Interested in Event']) },
    ];
    for (const cat of eventCats) {
      const evMsgs = store.data.content.filter(
        (c) => store.labelsByThread.get(c.thread_id)?.has('event') && c.content && cat.status.has(c.content),
      );
      if (evMsgs.length > 0) {
        const lastTs = evMsgs.reduce((max, c) => Math.max(max, c.timestamp_ms), 0);
        let score = Math.min(
          Math.max(0, 20 * (1 - (now - lastTs) / TWO_YEARS)) + Math.min(Math.sqrt(evMsgs.length) * 5, 40),
          60,
        );
        if (cat.id === 'fb-event-owned') {
          score += 20;
        }
        threadsWithScore.push({
          id: cat.id,
          title: cat.title,
          platform: 'facebook',
          timestamp: lastTs,
          ...messageTimestampBounds(
            evMsgs.filter((m) => m.content === (cat.id === 'fb-event-owned' ? 'Created Event' : 'Joined Event')),
          ),
          is_group: false,
          pageCount: 1,
          type: 'event',
          messageCount: evMsgs.length,
          myMessageCount: evMsgs.length,
          participationRatio: 1,
          myAvgMessageLength: 0,
          qualityScore: Math.round(score),
        });
      }
    }
  }

  threadsWithScore.sort((a, b) => b.qualityScore - a.qualityScore);
  return jsonResponse(threadsWithScore);
}

function cleanThreadMessage(content: string): string | null {
  let clean = content;
  if (containsHtmlOrEntities(clean)) {
    clean = stripHtml(clean);
  }
  clean = stripUrls(clean);
  return clean || null;
}

function isUsableUserMessage(row: DemoContentRow, myNamesSet: Set<string>): boolean {
  if (!myNamesSet.has(row.sender_name) || !row.content) {
    return false;
  }
  const lower = row.content.toLowerCase();
  if (lower.endsWith('sent an attachment.') || lower.startsWith('http') || lower.startsWith('www.')) {
    return false;
  }
  return true;
}

function handleThreadContent(store: DemoStore, init?: RequestInit): Response {
  const { ids } = parseJsonBody<{ ids?: string[] }>(init);
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return jsonResponse({ error: 'Missing ids' }, 400);
  }

  const myNamesSet = new Set(store.myNames);
  const result: Record<string, string[]> = {};
  ids.forEach((id) => {
    result[id] = [];
  });

  const realThreadIds = ids.filter((id) => !id.startsWith('fb-post-') && !id.startsWith('fb-event-'));
  const hasPosts = ids.includes('fb-post-all');
  const virtualEventIds = ids.filter((id) => id.startsWith('fb-event-'));

  for (const tid of realThreadIds) {
    const msgs = store.contentByThread.get(tid) || [];
    for (const m of msgs) {
      if (result[tid].length >= 15) {
        break;
      }
      if (!isUsableUserMessage(m, myNamesSet)) {
        continue;
      }
      const clean = cleanThreadMessage(m.content!);
      if (clean) {
        result[tid].push(clean);
      }
    }
  }

  if (hasPosts) {
    const posts = store.data.content
      .filter(
        (m) =>
          store.labelsByThread.get(m.thread_id)?.has('post') &&
          m.content &&
          !m.content.toLowerCase().startsWith('http'),
      )
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, 100);
    for (const row of posts) {
      if (result['fb-post-all'].length >= 20) {
        break;
      }
      const clean = cleanThreadMessage(row.content!);
      if (clean) {
        result['fb-post-all'].push(`Social post: ${clean}`);
      }
    }
  }

  if (virtualEventIds.length > 0) {
    const eventRows = store.data.content
      .filter((m) => store.labelsByThread.get(m.thread_id)?.has('event'))
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, 100);
    for (const id of virtualEventIds) {
      const prefix = id === 'fb-event-owned' ? 'I am hosting an event:' : 'I am joining an event:';
      for (const row of eventRows) {
        if (result[id].length >= 20) {
          break;
        }
        const title = store.threadsById.get(row.thread_id)?.title;
        if (title) {
          const clean = cleanThreadMessage(title);
          if (clean) {
            result[id].push(`${prefix} ${clean}`);
          }
        }
      }
    }
  }

  return jsonResponse(result);
}

function handleSampleMessages(store: DemoStore, init?: RequestInit): Response {
  const { threadIds, limit = 100 } = parseJsonBody<{ threadIds?: string[]; limit?: number }>(init);
  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return jsonResponse({ error: 'Missing threadIds' }, 400);
  }

  const myNamesSet = new Set(store.myNames);
  const realThreadIds = new Set(threadIds.filter((id) => !id.startsWith('fb-post-') && !id.startsWith('fb-event-')));
  const hasPosts = threadIds.includes('fb-post-all');
  const hasEvents = threadIds.some((id) => id.startsWith('fb-event-'));

  const collected: string[] = [];

  if (realThreadIds.size > 0) {
    const realRows = store.data.content
      .filter((m) => realThreadIds.has(m.thread_id) && isUsableUserMessage(m, myNamesSet))
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, limit);
    for (const r of realRows) {
      collected.push(r.content!);
    }
  }

  if (hasPosts && collected.length < limit) {
    const postRows = store.data.content
      .filter(
        (m) =>
          store.labelsByThread.get(m.thread_id)?.has('post') &&
          m.content &&
          !m.content.toLowerCase().startsWith('http'),
      )
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, limit - collected.length);
    for (const r of postRows) {
      collected.push(r.content!);
    }
  }

  if (hasEvents && collected.length < limit) {
    const evRows = store.data.content
      .filter((m) => store.labelsByThread.get(m.thread_id)?.has('event'))
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, limit - collected.length);
    for (const r of evRows) {
      const title = store.threadsById.get(r.thread_id)?.title;
      if (title) {
        collected.push(title);
      }
    }
  }

  return jsonResponse({
    messages: collected.map((content) => {
      if (containsHtmlOrEntities(content)) {
        return stripUrls(stripHtml(content));
      }
      return stripUrls(content);
    }),
  });
}

function handleSampleThreadDays(store: DemoStore, init?: RequestInit): Response {
  const {
    threadIds,
    identityNames: uiNames,
    dateRange,
    timeZone,
    targetMessages,
  } = parseJsonBody<{
    threadIds?: string[];
    identityNames?: string[];
    dateRange?: { start: number; end: number };
    timeZone?: string;
    targetMessages?: number;
  }>(init);

  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return jsonResponse({ error: 'Missing threadIds' }, 400);
  }

  const mergedNames = [...new Set([...(uiNames || []), ...store.myNames])];
  const results: Record<string, ThreadDaySampleResult> = {};
  for (const threadId of threadIds) {
    results[threadId] = sampleThreadInStore(store, threadId, mergedNames, {
      dateRange,
      timeZone,
      targetMessages,
    });
  }

  return jsonResponse({ results });
}

async function handlePreviewDataset(store: DemoStore, init?: RequestInit): Promise<Response> {
  const body = parseJsonBody<{
    threadIds?: string[];
    identityNames?: string[];
    includeGroupSpeakerNames?: boolean;
    mergeSequential?: boolean;
    removeSystemMessages?: boolean;
    imputeReactions?: boolean;
    redactPII?: boolean;
    personaTag?: string;
    customInstructions?: string;
    skipSystemMessages?: boolean;
    dateRange?: { start: number; end: number };
    outputFormat?: 'jsonl' | 'markdown';
    selectedDaysByThread?: Record<string, string[]>;
    datasetName?: string;
    timeZone?: string;
  }>(init);

  if (!body.threadIds || !Array.isArray(body.threadIds) || body.threadIds.length === 0) {
    return jsonResponse({ error: 'Missing threadIds' }, 400);
  }
  if (!body.identityNames || !Array.isArray(body.identityNames) || body.identityNames.length === 0) {
    return jsonResponse({ error: 'Missing identityNames' }, 400);
  }

  const isMarkdown = body.outputFormat === 'markdown';
  const core = new DatasetCore({
    includeGroupSpeakerNames: !!body.includeGroupSpeakerNames,
    mergeSequential: !!body.mergeSequential,
    removeSystemMessages: !!body.removeSystemMessages,
    imputeReactions: !!body.imputeReactions,
    redactPII: !!body.redactPII,
    personaTag: body.personaTag || undefined,
    customInstructions: body.customInstructions || undefined,
    skipSystemMessages: !!body.skipSystemMessages,
    datasetName: body.datasetName || 'virtual_me',
    outputFormat: isMarkdown ? 'markdown' : 'jsonl',
    selectedDaysByThread: body.selectedDaysByThread,
    timeZone: body.timeZone,
    includeSummary: false,
    maxTokensPerSession: Infinity,
    maxTokensPerFile: 100000,
  });

  core.setDataSource(createDemoDataSource(store));

  const previewThreadIds = body.threadIds.slice(0, 3);
  const recordsStream = core.generateRecords(previewThreadIds, body.identityNames, body.dateRange);

  if (isMarkdown) {
    const files: { fileName: string; content: string }[] = [];
    const MAX_PREVIEW_CHARS = 12000;
    for await (const record of recordsStream) {
      throwIfAborted(init?.signal);
      if (record.kind === 'markdown') {
        const content =
          record.content.length > MAX_PREVIEW_CHARS
            ? `${record.content.slice(0, MAX_PREVIEW_CHARS)}\n\n... (truncated for preview)`
            : record.content;
        files.push({ fileName: record.fileName, content });
      }
    }
    return jsonResponse({ format: 'markdown', files });
  }

  const allSessions: DatasetEntry[] = [];
  for await (const record of recordsStream) {
    throwIfAborted(init?.signal);
    if (record.kind === 'session') {
      allSessions.push(record.entry);
    } else {
      allSessions.push({ messages: [{ role: 'assistant', content: record.content }] });
    }
    if (allSessions.length >= 20) {
      break;
    }
  }

  return jsonResponse({ sessions: allSessions.slice(-5) });
}

async function runDemoGenerationJob(
  jobId: string,
  store: DemoStore,
  body: {
    threadIds: string[];
    identityNames: string[];
    includeGroupSpeakerNames?: boolean;
    mergeSequential?: boolean;
    removeSystemMessages?: boolean;
    imputeReactions?: boolean;
    redactPII?: boolean;
    maxTokensPerSession?: number;
    maxTokensPerFile?: number;
    splitDataset?: boolean;
    personaTag?: string;
    customInstructions?: string;
    skipSystemMessages?: boolean;
    datasetName?: string;
    dateRange?: { start: number; end: number };
    outputFormat?: 'jsonl' | 'markdown';
    selectedDaysByThread?: Record<string, string[]>;
    timeZone?: string;
  },
): Promise<void> {
  const job = demoJobs.get(jobId);
  if (!job) {
    return;
  }

  try {
    job.status = 'processing';

    const identityNames = [...new Set([...body.identityNames, ...store.myNames])];
    const core = new DatasetCore({
      includeGroupSpeakerNames: !!body.includeGroupSpeakerNames,
      mergeSequential: !!body.mergeSequential,
      removeSystemMessages: !!body.removeSystemMessages,
      imputeReactions: !!body.imputeReactions,
      redactPII: !!body.redactPII,
      maxTokensPerSession: body.maxTokensPerSession || Infinity,
      maxTokensPerFile: body.maxTokensPerFile || (body.splitDataset ? 1900000 : Number.MAX_SAFE_INTEGER),
      personaTag: body.personaTag || undefined,
      customInstructions: body.customInstructions || undefined,
      skipSystemMessages: !!body.skipSystemMessages,
      datasetName: body.datasetName || undefined,
      outputFormat: body.outputFormat || 'jsonl',
      selectedDaysByThread: body.selectedDaysByThread,
      timeZone: body.timeZone,
    });
    core.setDataSource(createDemoDataSource(store));

    const zip = new JSZip();
    let partCount = 0;

    for await (const file of core.generateStream(body.threadIds, identityNames, body.dateRange, (current, total) => {
      job.progress = current;
      job.total = total;
    })) {
      zip.file(file.fileName, file.content);
      partCount++;
    }

    if (partCount === 0) {
      throw new Error(
        'No valid training data found in selection. Ensure you selected threads where you are an active participant.',
      );
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    job.blob = blob;
    job.progress = body.threadIds.length;
    job.total = body.threadIds.length;
    job.status = 'completed';
  } catch (error: unknown) {
    job.status = 'failed';
    job.error = (error as Error).message || 'Unknown error';
  }
}

function handleGenerateDataset(store: DemoStore, init?: RequestInit): Response {
  const body = parseJsonBody<{
    threadIds?: string[];
    identityNames?: string[];
    includeGroupSpeakerNames?: boolean;
    mergeSequential?: boolean;
    removeSystemMessages?: boolean;
    imputeReactions?: boolean;
    redactPII?: boolean;
    maxTokensPerSession?: number;
    maxTokensPerFile?: number;
    splitDataset?: boolean;
    personaTag?: string;
    customInstructions?: string;
    skipSystemMessages?: boolean;
    datasetName?: string;
    dateRange?: { start: number; end: number };
    outputFormat?: 'jsonl' | 'markdown';
    selectedDaysByThread?: Record<string, string[]>;
    timeZone?: string;
  }>(init);

  if (!body.threadIds || !Array.isArray(body.threadIds) || body.threadIds.length === 0) {
    return jsonResponse({ error: 'Missing threadIds' }, 400);
  }
  if (!body.identityNames || !Array.isArray(body.identityNames) || body.identityNames.length === 0) {
    return jsonResponse({ error: 'Missing identityNames' }, 400);
  }

  // Revoke old Blob URLs so previous ZIPs don't stay in memory.
  for (const oldJob of demoJobs.values()) {
    if (oldJob.blobUrl) {
      URL.revokeObjectURL(oldJob.blobUrl);
      oldJob.blobUrl = undefined;
    }
  }

  const jobId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  demoJobs.set(jobId, {
    id: jobId,
    status: 'pending',
    progress: 0,
    total: body.threadIds.length,
  });

  void runDemoGenerationJob(jobId, store, {
    ...body,
    threadIds: body.threadIds,
    identityNames: body.identityNames,
  });

  return jsonResponse({ jobId, status: 'pending' }, 202);
}

function handleJobStatus(url: URL): Response {
  const id = url.searchParams.get('id');
  if (!id) {
    return jsonResponse({ error: 'Missing job ID' }, 400);
  }
  const job = demoJobs.get(id);
  if (!job) {
    return jsonResponse({ error: 'Job not found' }, 404);
  }
  return jsonResponse({
    id: job.id,
    status: job.status,
    progress: job.progress,
    total: job.total,
    error: job.error,
  });
}

/**
 * Create a download URL for the demo ZIP built in the browser.
 */
export function getDemoJobDownloadUrl(jobId: string): string | null {
  const job = demoJobs.get(jobId);
  if (!job || job.status !== 'completed' || !job.blob) {
    return null;
  }
  if (!job.blobUrl) {
    job.blobUrl = URL.createObjectURL(job.blob);
  }
  return job.blobUrl;
}

/**
 * Serve static demo API requests from the exported JSON bundle.
 */
export async function handleDemoFetch(input: string, init?: RequestInit): Promise<Response> {
  throwIfAborted(init?.signal);

  const url = new URL(input, 'http://demo.local');
  const pathname = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();

  // Answer these requests without loading the demo data.
  if (pathname === '/api/setup/ingest-status') {
    return jsonResponse({ isRunning: false });
  }
  if (pathname === '/api/job-status') {
    return handleJobStatus(url);
  }
  if (pathname.startsWith('/api/setup/') || pathname.startsWith('/api/system/') || pathname === '/api/fb-image-proxy') {
    return jsonResponse({ error: 'Not available in Demo Mode' }, 501);
  }

  const store = await loadDemoData();
  throwIfAborted(init?.signal);

  switch (pathname) {
    case '/api/status':
      return handleStatus(store);
    case '/api/identity':
      return jsonResponse({ names: store.myNames });
    case '/api/threads':
      return handleThreads(store, url);
    case '/api/content':
      return handleContent(store, url);
    case '/api/jump':
      return handleJump(store, url);
    case '/api/search':
      return handleSearch(store, url);
    case '/api/media-gallery':
      return handleMediaGallery(store, url);
    case '/api/studio/dataset-threads':
      return handleDatasetThreads(store, url);
    case '/api/studio/thread-content':
      if (method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
      return handleThreadContent(store, init);
    case '/api/studio/sample-messages':
      if (method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
      return handleSampleMessages(store, init);
    case '/api/studio/sample-thread-days':
      if (method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
      return handleSampleThreadDays(store, init);
    case '/api/studio/preview-dataset':
      if (method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
      return handlePreviewDataset(store, init);
    case '/api/studio/generate-dataset':
      if (method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
      return handleGenerateDataset(store, init);
    case '/api/preview': {
      const targetUrl = url.searchParams.get('url') || '';
      const cached = store.data.linkPreviews?.[targetUrl];
      if (cached) {
        return jsonResponse(cached);
      }
      return jsonResponse({ error: 'Link previews unavailable in Demo Mode' }, 404);
    }
    default:
      return jsonResponse({ error: `Demo route not implemented: ${pathname}` }, 404);
  }
}
