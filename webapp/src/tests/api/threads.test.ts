// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/threads';

import { createMemoryDb, seedMessage, seedThread } from '../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/threads', () => {
  let memDb: Database.Database | null = null;

  beforeEach(() => {
    vi.mocked(getMyNames).mockResolvedValue(['Me', 'John Doe']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (memDb) {
      memDb.close();
      memDb = null;
    }
  });

  it('returns archive status while keeping archived conversations in Messages', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, {
      id: 'archived',
      platform: 'facebook',
      title: 'Archived chat',
      labels: ['message', 'archived'],
    });
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);
    const { req, res } = createMocks({ method: 'GET', query: { platform: 'facebook', type: 'message' } });
    await handler(req, res);
    expect(res._getJSONData().threads).toEqual([expect.objectContaining({ id: 'archived', archived: true })]);
  });

  it('returns cutover status for labeled Facebook conversations', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, {
      id: 'cutover',
      platform: 'facebook',
      title: 'Cutover chat',
      labels: ['message', 'e2ee_cutover'],
    });
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);
    const { req, res } = createMocks({ method: 'GET', query: { platform: 'facebook', type: 'message' } });
    await handler(req, res);
    expect(res._getJSONData().threads).toEqual([expect.objectContaining({ id: 'cutover', e2eeCutover: true })]);
  });

  it('returns empty array when DB does not exist', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const { req, res } = createMocks({ method: 'GET', query: { platform: 'facebook' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual([]);
  });

  it('filters by platform label or array, filters by type, infers titles, and calculates counts and pageCount', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, {
      id: 'gm_1',
      platform: 'google_mail',
      title: 'Project Update',
      participants: ['Alice'],
      last_activity_ms: 2000,
      snippet: 'Release notes',
      labels: ['inbox'],
    });
    seedThread(memDb, {
      id: 'gm_2',
      platform: 'google_mail',
      title: null,
      participants: ['Me', 'Bob'],
      last_activity_ms: 3000,
      snippet: 'Sent item',
      labels: ['sent'],
    });
    seedThread(memDb, {
      id: 'fb_1',
      platform: 'facebook',
      title: 'FB Chat',
      participants: ['Charlie'],
      last_activity_ms: 5000,
      snippet: 'Yo',
      labels: ['message'],
    });

    // The 105 messages in gm_1 should span two pages.
    for (let i = 0; i < 105; i++) {
      seedMessage(memDb, { thread_id: 'gm_1', sender_name: 'Alice', timestamp_ms: 100 + i, content: `m${i}` });
    }

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    // “Gmail” should resolve to google_mail and still honor the inbox filter.
    const inboxCall = createMocks({ method: 'GET', query: { platform: 'Gmail', type: 'inbox' } });
    await handler(inboxCall.req, inboxCall.res);

    expect(inboxCall.res._getStatusCode()).toBe(200);
    const inboxData = inboxCall.res._getJSONData();
    expect(inboxData.counts).toMatchObject({ inbox: 1, sent: 1, message: 0 });
    expect(inboxData.threads).toEqual([
      {
        id: 'gm_1',
        platform: 'google_mail',
        title: 'Project Update',
        participants: ['Alice'],
        timestamp: 2000,
        firstMessageTimestamp: 100,
        lastMessageTimestamp: 204,
        snippet: 'Release notes',
        pageCount: 2,
      },
    ]);

    // Array of platforms + type='all'
    const multiCall = createMocks({
      method: 'GET',
      query: { platform: ['Gmail', 'facebook'], type: 'all' },
    });
    await handler(multiCall.req, multiCall.res);
    const multiData = multiCall.res._getJSONData();
    expect(multiData.threads.map((t: { id: string; title: string }) => `${t.id}:${t.title}`)).toEqual([
      'fb_1:FB Chat',
      'gm_2:Bob',
      'gm_1:Project Update',
    ]);
  });

  it('returns virtual Facebook event buckets with latest event title and No events fallback', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, {
      id: 'fb_e1',
      platform: 'facebook',
      title: 'Launch Party',
      last_activity_ms: 5000,
      labels: ['event'],
    });
    seedMessage(memDb, {
      thread_id: 'fb_e1',
      sender_name: 'Me',
      timestamp_ms: 5000,
      content: 'Created Event',
    });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'GET',
      query: { platform: 'facebook', type: 'event' },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.threads).toEqual([
      {
        id: 'fb-event-owned',
        platform: 'facebook',
        title: 'Your Events',
        timestamp: 5000,
        firstMessageTimestamp: 5000,
        lastMessageTimestamp: 5000,
        snippet: 'Latest: Launch Party',
        pageCount: 1,
      },
      {
        id: 'fb-event-joined',
        platform: 'facebook',
        title: 'Joined Events',
        timestamp: 0,
        firstMessageTimestamp: null,
        lastMessageTimestamp: null,
        snippet: 'No events',
        pageCount: 0,
      },
      {
        id: 'fb-event-interested',
        platform: 'facebook',
        title: 'Events Interested In',
        timestamp: 0,
        firstMessageTimestamp: null,
        lastMessageTimestamp: null,
        snippet: 'No events',
        pageCount: 0,
      },
      {
        id: 'fb-event-declined',
        platform: 'facebook',
        title: 'Declined Events',
        timestamp: 0,
        firstMessageTimestamp: null,
        lastMessageTimestamp: null,
        snippet: 'No events',
        pageCount: 0,
      },
    ]);
  });

  it('returns virtual Facebook post and checkin threads', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'p1', platform: 'facebook', title: 'P1', last_activity_ms: 4000, labels: ['post'] });
    seedThread(memDb, { id: 'p2', platform: 'facebook', title: 'P2', last_activity_ms: 6000, labels: ['post'] });
    seedThread(memDb, { id: 'c1', platform: 'facebook', title: 'C1', last_activity_ms: 7000, labels: ['checkin'] });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    seedMessage(memDb, { thread_id: 'p2', timestamp_ms: 500, content: 'First post', sender_name: 'Me' });
    const postCall = createMocks({ method: 'GET', query: { platform: 'facebook', type: 'post' } });
    await handler(postCall.req, postCall.res);
    expect(postCall.res._getJSONData().threads).toEqual([
      {
        id: 'fb-post-all',
        platform: 'facebook',
        title: 'My Posts',
        timestamp: 6000,
        firstMessageTimestamp: 500,
        lastMessageTimestamp: 500,
        snippet: 'Browse all 2 posts',
        pageCount: 1,
      },
    ]);

    const checkinCall = createMocks({ method: 'GET', query: { platform: 'facebook', type: 'checkin' } });
    await handler(checkinCall.req, checkinCall.res);
    expect(checkinCall.res._getJSONData().threads).toEqual([
      {
        id: 'fb-checkin-all',
        platform: 'facebook',
        title: 'My Check-ins',
        timestamp: 7000,
        firstMessageTimestamp: null,
        lastMessageTimestamp: null,
        snippet: 'Browse all 1 check-ins',
        pageCount: 1,
      },
    ]);
  });

  it('returns 500 when querying threads fails', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('Query failed');
    });

    const { req, res } = createMocks({ method: 'GET', query: { platform: 'facebook' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Failed to load threads' });
  });
});
