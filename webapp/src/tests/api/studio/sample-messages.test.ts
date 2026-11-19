// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/studio/sample-messages';

import { createMemoryDb, seedMessage, seedThread } from '../../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/studio/sample-messages', () => {
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

  it('returns 400 when threadIds is missing or empty', async () => {
    const missing = createMocks({ method: 'POST', body: {} });
    await handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(400);

    const empty = createMocks({ method: 'POST', body: { threadIds: [] } });
    await handler(empty.req, empty.res);
    expect(empty.res._getStatusCode()).toBe(400);
  });

  it('fetches sender messages across real threads, virtual posts, and events while stripping HTML and URLs', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'chat_1', platform: 'facebook', title: 'Chat' });
    seedThread(memDb, { id: 'post_1', platform: 'facebook', title: 'Post', labels: ['post'] });
    seedThread(memDb, { id: 'evt_1', platform: 'facebook', title: 'Rooftop Dinner', labels: ['event'] });

    seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Me',
      timestamp_ms: 4000,
      content: '<p>Hello &amp; check https://example.com/a</p>',
    });
    seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Me',
      timestamp_ms: 3000,
      content: 'Plain note http://ignored.link',
    });
    seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Me',
      timestamp_ms: 2000,
      content: 'John sent an attachment.',
    });
    seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Me',
      timestamp_ms: 1500,
      content: 'www.skipped.com',
    });
    seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Alice',
      timestamp_ms: 1000,
      content: 'Other person message',
    });
    seedMessage(memDb, {
      thread_id: 'post_1',
      sender_name: 'Me',
      timestamp_ms: 2500,
      content: 'Post update https://post.link',
    });
    seedMessage(memDb, {
      thread_id: 'evt_1',
      sender_name: 'Me',
      timestamp_ms: 2600,
      content: 'Created Event',
    });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        threadIds: ['chat_1', 'fb-post-all', 'fb-event-owned'],
        limit: 10,
      },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      messages: ['Hello & check', 'Plain note', 'Post update', 'Rooftop Dinner'],
    });
  });

  it('respects the limit parameter across combined sources', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'chat_1', platform: 'facebook', title: 'Chat' });
    seedThread(memDb, { id: 'post_1', platform: 'facebook', title: 'Post', labels: ['post'] });

    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Me', timestamp_ms: 2000, content: 'Msg 2' });
    seedMessage(memDb, { thread_id: 'chat_1', sender_name: 'Me', timestamp_ms: 1000, content: 'Msg 1' });
    seedMessage(memDb, { thread_id: 'post_1', sender_name: 'Me', timestamp_ms: 3000, content: 'Post 1' });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['chat_1', 'fb-post-all'], limit: 2 },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().messages).toEqual(['Msg 2', 'Msg 1']);
  });

  it('returns 500 when DB throws', async () => {
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('DB fail');
    });

    const { req, res } = createMocks({ method: 'POST', body: { threadIds: ['chat_1'] } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error' });
  });
});
