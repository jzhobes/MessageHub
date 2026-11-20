// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import handler from '@/pages/api/jump';

import { createMemoryDb, seedMessage, seedThread } from '../helpers/testDb';

import type Database from 'better-sqlite3';

describe('/api/jump', () => {
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

  it('returns 400 when messageId is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Missing messageId' });
  });

  it('returns 404 when message does not exist', async () => {
    memDb = createMemoryDb();
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({ method: 'GET', query: { messageId: '9999' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(res._getJSONData()).toEqual({ error: 'Content not found' });
  });

  it('calculates rank with timestamp tie-breakers and page boundaries across >100 messages', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'chat_1', platform: 'instagram', labels: ['dm', 'message'] });

    // Seed two rows at the oldest timestamp and 100 newer ones.
    const firstId = seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Alice',
      timestamp_ms: 1000,
      content: 'oldest-lower-id',
    });
    const secondSameTsId = seedMessage(memDb, {
      thread_id: 'chat_1',
      sender_name: 'Bob',
      timestamp_ms: 1000,
      content: 'oldest-higher-id',
    });
    for (let i = 0; i < 100; i++) {
      seedMessage(memDb, {
        thread_id: 'chat_1',
        sender_name: 'Alice',
        timestamp_ms: 2000 + i,
        content: `msg-${i}`,
      });
    }

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    // There are 100 newer rows, so secondSameTsId is 101st and lands on page 2.
    const callPage2 = createMocks({ method: 'GET', query: { messageId: String(secondSameTsId) } });
    await handler(callPage2.req, callPage2.res);
    expect(callPage2.res._getStatusCode()).toBe(200);
    expect(callPage2.res._getJSONData()).toEqual({
      threadId: 'chat_1',
      platform: 'instagram',
      page: 2,
      timestamp: 1000,
      category: 'message',
    });

    // firstId is 102nd because the other row at that timestamp sorts ahead of it.
    const callTieBreaker = createMocks({ method: 'GET', query: { messageId: String(firstId) } });
    await handler(callTieBreaker.req, callTieBreaker.res);
    expect(callTieBreaker.res._getJSONData().page).toBe(2);
  });

  it('prioritizes inbox over custom labels and defaults to message when unlabeled', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'mail_1', platform: 'google_mail', labels: ['sent', 'inbox'] });
    seedThread(memDb, { id: 'unlabeled_1', platform: 'google_voice', labels: [] });

    const mailMsgId = seedMessage(memDb, {
      thread_id: 'mail_1',
      sender_name: 'Boss',
      timestamp_ms: 5000,
      content: 'Report',
    });
    const voiceMsgId = seedMessage(memDb, {
      thread_id: 'unlabeled_1',
      sender_name: 'Friend',
      timestamp_ms: 6000,
      content: 'Hey',
    });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const mailCall = createMocks({ method: 'GET', query: { messageId: String(mailMsgId) } });
    await handler(mailCall.req, mailCall.res);
    expect(mailCall.res._getJSONData().category).toBe('inbox');

    const voiceCall = createMocks({ method: 'GET', query: { messageId: String(voiceMsgId) } });
    await handler(voiceCall.req, voiceCall.res);
    expect(voiceCall.res._getJSONData().category).toBe('message');
  });

  it('resolves virtual post, checkin, and all 4 event buckets', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'p1', platform: 'facebook', labels: ['post'] });
    seedThread(memDb, { id: 'p2', platform: 'facebook', labels: ['post'] });
    seedThread(memDb, { id: 'c1', platform: 'facebook', labels: ['checkin'] });
    seedThread(memDb, { id: 'e1', platform: 'facebook', labels: ['event'] });
    seedThread(memDb, { id: 'e2', platform: 'facebook', labels: ['event'] });
    seedThread(memDb, { id: 'e3', platform: 'facebook', labels: ['event'] });
    seedThread(memDb, { id: 'e4', platform: 'facebook', labels: ['event'] });

    const postOlderId = seedMessage(memDb, {
      thread_id: 'p1',
      sender_name: 'Me',
      timestamp_ms: 100,
      content: 'Old post',
    });
    seedMessage(memDb, { thread_id: 'p2', sender_name: 'Me', timestamp_ms: 200, content: 'New post' });
    const checkinId = seedMessage(memDb, { thread_id: 'c1', sender_name: 'Me', timestamp_ms: 300, content: 'Cafe' });

    const ownedId = seedMessage(memDb, {
      thread_id: 'e1',
      sender_name: 'Me',
      timestamp_ms: 400,
      content: 'Created Event',
    });
    const joinedId = seedMessage(memDb, {
      thread_id: 'e2',
      sender_name: 'Me',
      timestamp_ms: 500,
      content: 'Joined Event',
    });
    const interestedId = seedMessage(memDb, {
      thread_id: 'e3',
      sender_name: 'Me',
      timestamp_ms: 600,
      content: 'Interested in Event',
    });
    const declinedId = seedMessage(memDb, {
      thread_id: 'e4',
      sender_name: 'Me',
      timestamp_ms: 700,
      content: 'Declined Event',
    });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const postCall = createMocks({ method: 'GET', query: { messageId: String(postOlderId) } });
    await handler(postCall.req, postCall.res);
    expect(postCall.res._getJSONData()).toEqual({
      threadId: 'fb-post-all',
      platform: 'facebook',
      page: 1,
      timestamp: 100,
      category: 'post',
    });

    const checkinCall = createMocks({ method: 'GET', query: { messageId: String(checkinId) } });
    await handler(checkinCall.req, checkinCall.res);
    expect(checkinCall.res._getJSONData().threadId).toBe('fb-checkin-all');

    const eventExpectations: Array<[number, string]> = [
      [ownedId, 'fb-event-owned'],
      [joinedId, 'fb-event-joined'],
      [interestedId, 'fb-event-interested'],
      [declinedId, 'fb-event-declined'],
    ];

    for (const [msgId, expectedThreadId] of eventExpectations) {
      const eventCall = createMocks({ method: 'GET', query: { messageId: String(msgId) } });
      await handler(eventCall.req, eventCall.res);
      expect(eventCall.res._getJSONData()).toMatchObject({
        threadId: expectedThreadId,
        platform: 'facebook',
        category: 'event',
        page: 1,
      });
    }
  });

  it('returns 500 when querying fails', async () => {
    memDb = createMemoryDb();
    vi.spyOn(memDb, 'prepare').mockImplementation(() => {
      throw new Error('SQL error');
    });
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({ method: 'GET', query: { messageId: '1' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error' });
  });
});
