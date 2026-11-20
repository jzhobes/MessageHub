// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/studio/sample-thread-days';

import { createMemoryDb, seedMessage, seedThread } from '../../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/studio/sample-thread-days', () => {
  let memDb: Database.Database | null = null;

  beforeEach(() => {
    vi.mocked(getMyNames).mockResolvedValue(['Me']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (memDb) {
      memDb.close();
      memDb = null;
    }
  });

  it('rejects non-POST methods with 405 and Allow header', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res.getHeader('Allow')).toEqual(['POST']);
    expect(res._getData()).toBe('Method GET Not Allowed');
  });

  it.each([
    ['missing', {}],
    ['non-array', { threadIds: 't1' }],
    ['empty array', { threadIds: [] }],
  ])('returns 400 when threadIds is %s', async (_label, body) => {
    const { req, res } = createMocks({ method: 'POST', body });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Missing threadIds' });
  });

  it('returns empty results when DB does not exist', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['t1'] },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ results: {} });
  });

  it('scans multiple threads, merges identityNames with DB names, and returns per-day stats', async () => {
    memDb = createMemoryDb();

    const day1 = Date.UTC(2025, 0, 15, 12, 0, 0); // 2025-01-15
    const day2 = Date.UTC(2025, 2, 10, 12, 0, 0); // 2025-03-10

    seedThread(memDb, {
      id: 'chat_1',
      platform: 'instagram',
      title: 'Alice',
      participants: ['Me', 'MyAlias', 'Alice'],
      last_activity_ms: day2,
      labels: ['message'],
    });

    // Day 1: 2 messages from DB name ('Me') + 2 from Alice
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Me', timestamp_ms: day1, content: 'Hey Alice!' });
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Alice', timestamp_ms: day1 + 1000, content: 'Hi!' });
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Me', timestamp_ms: day1 + 2000, content: 'How are you?' });
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Alice', timestamp_ms: day1 + 3000, content: 'Doing well' });

    // Day 2: 2 messages from UI-supplied identity ('MyAlias') + 2 from Alice
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'MyAlias', timestamp_ms: day2, content: 'Checking in!' });
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Alice', timestamp_ms: day2 + 1000, content: 'Hey!' });
    seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'MyAlias',
      timestamp_ms: day2 + 2000,
      content: 'All good?',
    });
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Alice', timestamp_ms: day2 + 3000, content: 'Yep!' });

    // Virtual Facebook event thread to also exercise multi-thread iteration (setImmediate yield)
    seedThread(memDb, {
      id: 'evt_1',
      platform: 'facebook',
      title: 'Launch Party',
      last_activity_ms: day2,
      labels: ['event'],
    });
    seedMessage(memDb, {
      thread_id: 'evt_1',
      sender_name: 'Me',
      timestamp_ms: day2,
      content: 'Created Event',
    });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        threadIds: ['chat_1', 'fb-event-owned'],
        identityNames: ['MyAlias', 'Me'],
        timeZone: 'UTC',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { results } = res._getJSONData();

    expect(results.chat_1).toEqual({
      selectedDays: ['2025-01-15', '2025-03-10'],
      dayStats: {
        '2025-01-15': { totalMsgs: 4, myMsgs: 2 },
        '2025-03-10': { totalMsgs: 4, myMsgs: 2 },
      },
      totalSelectedMsgs: 8,
    });

    expect(results['fb-event-owned']).toEqual({
      selectedDays: [],
      dayStats: {},
      totalSelectedMsgs: 1,
      isEvent: true,
    });
  });

  it('forwards dateRange, timeZone, and targetMessages and works when identityNames is omitted', async () => {
    memDb = createMemoryDb();

    // 2025-01-15 23:30 UTC -> 2025-01-16 in Asia/Tokyo (+9)
    const janTs = Date.UTC(2025, 0, 15, 23, 30, 0);
    const febTs = Date.UTC(2025, 1, 20, 12, 0, 0);

    seedThread(memDb, {
      id: 'chat_tz',
      platform: 'facebook',
      title: 'Bob',
      participants: ['Me', 'Bob'],
      last_activity_ms: febTs,
      labels: ['message'],
    });

    // 4 messages in Jan (inside dateRange)
    for (let i = 0; i < 2; i++) {
      seedMessage(memDb, {
        thread_id: 'chat_tz',
        sender_name: 'Me',
        timestamp_ms: janTs + i * 2000,
        content: `Jan message from me ${i}`,
      });
      seedMessage(memDb, {
        thread_id: 'chat_tz',
        sender_name: 'Bob',
        timestamp_ms: janTs + i * 2000 + 1000,
        content: `Jan reply from Bob ${i}`,
      });
    }

    // 2 messages in Feb (outside dateRange)
    seedMessage(memDb, { thread_id: 'chat_tz', sender_name: 'Me', timestamp_ms: febTs, content: 'Feb message' });
    seedMessage(memDb, { thread_id: 'chat_tz', sender_name: 'Bob', timestamp_ms: febTs + 1000, content: 'Feb reply' });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        threadIds: ['chat_tz'],
        dateRange: { start: Date.UTC(2025, 0, 1), end: Date.UTC(2025, 0, 31, 23, 59, 59) },
        timeZone: 'Asia/Tokyo',
        targetMessages: 4,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { results } = res._getJSONData();
    expect(results.chat_tz).toEqual({
      selectedDays: ['2025-01-16'],
      dayStats: {
        '2025-01-16': { totalMsgs: 4, myMsgs: 2 },
      },
      totalSelectedMsgs: 4,
    });
  });

  it('returns 500 with error details when scanning fails', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('Database locked');
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['t1'] },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({
      error: 'Internal Server Error',
      details: 'Database locked',
    });
    expect(console.error).toHaveBeenCalled();
  });
});
