// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/studio/thread-content';

import { createMemoryDb, seedMessage, seedThread } from '../../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/studio/thread-content', () => {
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

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST']);
  });

  it('returns 400 when ids is missing or empty', async () => {
    const missing = createMocks({ method: 'POST', body: {} });
    await handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(400);

    const empty = createMocks({ method: 'POST', body: { ids: [] } });
    await handler(empty.req, empty.res);
    expect(empty.res._getStatusCode()).toBe(400);
  });

  it('returns per-thread arrays with prefixes, HTML/URL stripping, and 15/20-item caps', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 't_real', platform: 'facebook', title: 'Chat' });
    seedThread(memDb, { id: 't_empty', platform: 'facebook', title: 'Empty' });
    seedThread(memDb, { id: 'post_1', platform: 'facebook', title: 'Post', labels: ['post'] });
    seedThread(memDb, { id: 'evt_1', platform: 'facebook', title: 'Tech Meetup', labels: ['event'] });

    // Seed 18 messages for real thread -> capped at 15, plus one URL-only HTML message skipped after cleaning
    seedMessage(memDb, {
      thread_id: 't_real',
      sender_name: 'Me',
      timestamp_ms: 999999,
      content: '<a>https://only-link.example</a>',
    });
    for (let i = 1; i <= 18; i++) {
      seedMessage(memDb, {
        thread_id: 't_real',
        sender_name: 'Me',
        timestamp_ms: i * 100,
        content: `Message &amp; #${i} https://example.com`,
      });
    }

    // Seed 22 post rows -> capped at 20 with 'Social post: ' prefix
    for (let i = 1; i <= 22; i++) {
      seedMessage(memDb, {
        thread_id: 'post_1',
        sender_name: 'Me',
        timestamp_ms: i * 100,
        content: `Post #${i}`,
      });
    }

    seedMessage(memDb, {
      thread_id: 'evt_1',
      sender_name: 'Me',
      timestamp_ms: 5000,
      content: 'Created Event',
    });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'POST',
      body: { ids: ['t_real', 't_empty', 'fb-post-all', 'fb-event-owned', 'fb-event-joined'] },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.t_empty).toEqual([]);
    expect(data.t_real).toHaveLength(15);
    expect(data.t_real[0]).toBe('Message & #18');
    expect(data['fb-post-all']).toHaveLength(20);
    expect(data['fb-post-all'][0]).toBe('Social post: Post #22');
    expect(data['fb-event-owned']).toEqual(['I am hosting an event: Tech Meetup']);
    expect(data['fb-event-joined']).toEqual(['I am joining an event: Tech Meetup']);
  });

  it('returns 500 when DB throws', async () => {
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('Query failure');
    });

    const { req, res } = createMocks({ method: 'POST', body: { ids: ['t1'] } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error' });
  });
});
