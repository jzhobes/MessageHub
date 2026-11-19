// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/studio/dataset-threads';

import { createMemoryDb, seedMessage, seedThread } from '../../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/studio/dataset-threads', () => {
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

  it('returns empty array when DB does not exist', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const { req, res } = createMocks({ method: 'GET', query: { platform: 'all' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual([]);
  });

  it('scores active threads, zeros threads with <5 my messages, excludes URLs, and sorts descending', async () => {
    memDb = createMemoryDb();
    const now = Date.now();

    seedThread(memDb, {
      id: 'high_score',
      platform: 'instagram',
      title: null,
      participants: ['Me', 'Alice'],
      last_activity_ms: now - 1000,
      labels: ['message'],
    });
    seedThread(memDb, {
      id: 'low_count',
      platform: 'facebook',
      title: 'Low Activity',
      participants: ['Me', 'Bob'],
      last_activity_ms: now - 2000,
      labels: ['message'],
    });

    // 6 substantive messages from Me + 2 from Alice (URLs should not count toward myCount)
    for (let i = 0; i < 6; i++) {
      seedMessage(memDb, {
        thread_id: 'high_score',
        sender_name: 'Me',
        timestamp_ms: now - 10000 + i,
        content: `Detailed thoughtful message number ${i} about engineering`,
      });
    }
    seedMessage(memDb, {
      thread_id: 'high_score',
      sender_name: 'Me',
      timestamp_ms: now - 50,
      content: 'https://example.com/only-a-link',
    });
    seedMessage(memDb, {
      thread_id: 'high_score',
      sender_name: 'Alice',
      timestamp_ms: now - 40,
      content: 'Nice!',
    });

    // Only 3 messages from Me (< 5 threshold -> qualityScore 0)
    for (let i = 0; i < 3; i++) {
      seedMessage(memDb, {
        thread_id: 'low_count',
        sender_name: 'Me',
        timestamp_ms: now - 3000 + i,
        content: `Short ${i}`,
      });
    }

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const allCall = createMocks({ method: 'GET', query: { platform: 'all' } });
    await handler(allCall.req, allCall.res);

    expect(allCall.res._getStatusCode()).toBe(200);
    const data = allCall.res._getJSONData();
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      id: 'high_score',
      title: 'Alice',
      platform: 'instagram',
      messageCount: 8,
      myMessageCount: 6,
    });
    expect(data[0].qualityScore).toBeGreaterThan(0);
    expect(data[1]).toMatchObject({
      id: 'low_count',
      myMessageCount: 3,
      qualityScore: 0,
    });

    // Filter to instagram only -> excludes facebook thread and virtual facebook threads
    const igCall = createMocks({ method: 'GET', query: { platform: ['instagram'] } });
    await handler(igCall.req, igCall.res);
    expect(igCall.res._getJSONData()).toHaveLength(1);
    expect(igCall.res._getJSONData()[0].id).toBe('high_score');
  });

  it('includes virtual Facebook posts and events when platform is all or facebook', async () => {
    memDb = createMemoryDb();
    const now = Date.now();

    seedThread(memDb, {
      id: 'post_1',
      platform: 'facebook',
      title: 'Post 1',
      last_activity_ms: now - 1000,
      labels: ['post'],
    });
    seedMessage(memDb, {
      thread_id: 'post_1',
      sender_name: 'Me',
      timestamp_ms: now - 1000,
      content: 'Sharing thoughts about distributed systems',
    });

    seedThread(memDb, {
      id: 'evt_1',
      platform: 'facebook',
      title: 'Hackathon',
      last_activity_ms: now - 2000,
      labels: ['event'],
    });
    seedMessage(memDb, { thread_id: 'evt_1', sender_name: 'Me', timestamp_ms: now - 2000, content: 'Created Event' });
    seedMessage(memDb, {
      thread_id: 'evt_1',
      sender_name: 'Me',
      timestamp_ms: now - 1500,
      content: 'Interested in Event',
    });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({ method: 'GET', query: { platform: 'facebook' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.map((t: { id: string }) => t.id).sort()).toEqual(['fb-event-joined', 'fb-event-owned', 'fb-post-all']);
    const owned = data.find((t: { id: string }) => t.id === 'fb-event-owned');
    const joined = data.find((t: { id: string }) => t.id === 'fb-event-joined');
    expect(owned.qualityScore).toBeGreaterThan(joined.qualityScore);
  });

  it('returns 500 when analysis fails', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('Analysis crash');
    });

    const { req, res } = createMocks({ method: 'GET', query: { platform: 'all' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Analysis failed' });
  });
});
