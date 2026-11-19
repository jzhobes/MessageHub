// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import handler from '@/pages/api/media-gallery';

import { createMemoryDb, seedMessage, seedThread } from '../helpers/testDb';

import type Database from 'better-sqlite3';

describe('/api/media-gallery', () => {
  let memDb: Database.Database | null = null;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (memDb) {
      memDb.close();
      memDb = null;
    }
  });

  it('returns 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 400 when threadId is missing or an array', async () => {
    const missing = createMocks({ method: 'GET', query: {} });
    await handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(400);

    const arr = createMocks({ method: 'GET', query: { threadId: ['a', 'b'] } });
    await handler(arr.req, arr.res);
    expect(arr.res._getStatusCode()).toBe(400);
  });

  it('returns empty media array when DB does not exist', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const { req, res } = createMocks({ method: 'GET', query: { threadId: 't1' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ media: [], total: 0 });
  });

  it('extracts media in descending timestamp order, promotes media files, and ignores non-media or bad JSON', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 't1', platform: 'google_chat', title: 'Chat' });
    seedThread(memDb, { id: 't2', platform: 'facebook', title: 'Other' });

    const id1 = seedMessage(memDb, {
      thread_id: 't1',
      sender_name: 'Alice',
      timestamp_ms: 1000,
      media_json: JSON.stringify([
        { type: 'photo', uri: 'p1.jpg' },
        { type: 'video', uri: 'v1.mp4', thumbnail_uri: 'v1-thumb.jpg' },
        { type: 'sticker', uri: 's1.png' },
        { type: 'file', uri: 'doc.pdf' },
      ]),
    });

    const id2 = seedMessage(memDb, {
      thread_id: 't1',
      sender_name: 'Bob',
      timestamp_ms: 2000,
      media_json: JSON.stringify([
        { type: 'file', uri: 'pic.HEIC' },
        { type: 'file', uri: 'clip.mov' },
        { type: 'file', uri: 'loop.gif' },
        { type: 'gif', uri: 'anim.gif' },
      ]),
    });

    // Invalid JSON row and another thread's media should not crash or leak
    seedMessage(memDb, {
      thread_id: 't1',
      sender_name: 'Bob',
      timestamp_ms: 1500,
      media_json: '{bad json',
    });
    seedMessage(memDb, {
      thread_id: 't2',
      sender_name: 'Eve',
      timestamp_ms: 3000,
      media_json: JSON.stringify([{ type: 'photo', uri: 'other.jpg' }]),
    });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({ method: 'GET', query: { threadId: 't1' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.total).toBe(7);
    expect(data.media).toEqual([
      { messageId: id2, threadId: 't1', timestamp: 2000, mediaUrl: 'pic.HEIC', mediaType: 'photo' },
      { messageId: id2, threadId: 't1', timestamp: 2000, mediaUrl: 'clip.mov', mediaType: 'video' },
      { messageId: id2, threadId: 't1', timestamp: 2000, mediaUrl: 'loop.gif', mediaType: 'gif' },
      { messageId: id2, threadId: 't1', timestamp: 2000, mediaUrl: 'anim.gif', mediaType: 'gif' },
      { messageId: id1, threadId: 't1', timestamp: 1000, mediaUrl: 'p1.jpg', mediaType: 'photo' },
      {
        messageId: id1,
        threadId: 't1',
        timestamp: 1000,
        mediaUrl: 'v1.mp4',
        mediaType: 'video',
        thumbnailUrl: 'v1-thumb.jpg',
      },
      { messageId: id1, threadId: 't1', timestamp: 1000, mediaUrl: 's1.png', mediaType: 'sticker' },
    ]);
  });

  it('returns 500 when DB throws', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('DB fail');
    });

    const { req, res } = createMocks({ method: 'GET', query: { threadId: 't1' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal server error' });
  });
});
