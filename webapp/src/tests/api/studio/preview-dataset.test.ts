// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';
import handler from '@/pages/api/studio/preview-dataset';

import { createMemoryDb, seedMessage, seedThread } from '../../helpers/testDb';

import type Database from 'better-sqlite3';

describe('/api/studio/preview-dataset', () => {
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

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST']);
  });

  it('returns 400 when threadIds or identityNames is missing or empty', async () => {
    const missingThreads = createMocks({ method: 'POST', body: { identityNames: ['Me'] } });
    await handler(missingThreads.req, missingThreads.res);
    expect(missingThreads.res._getStatusCode()).toBe(400);

    const emptyIdentity = createMocks({ method: 'POST', body: { threadIds: ['t1'], identityNames: [] } });
    await handler(emptyIdentity.req, emptyIdentity.res);
    expect(emptyIdentity.res._getStatusCode()).toBe(400);
  });

  it('slices threadIds to first 3 and runs DatasetGenerator against SQLite DB', async () => {
    memDb = createMemoryDb();
    for (let t = 1; t <= 4; t++) {
      seedThread(memDb, {
        id: `t${t}`,
        platform: 'facebook',
        title: `Thread ${t}`,
        participants: ['Me', `Friend ${t}`],
      });
      seedMessage(memDb, {
        thread_id: `t${t}`,
        sender_name: `Friend ${t}`,
        timestamp_ms: 1000,
        content: `Question from ${t}?`,
      });
      seedMessage(memDb, {
        thread_id: `t${t}`,
        sender_name: 'Me',
        timestamp_ms: 2000,
        content: `Answer in thread ${t}!`,
      });
    }

    vi.spyOn(db, 'get').mockReturnValue(memDb);
    const streamSpy = vi.spyOn(DatasetGenerator.prototype, 'generateRecords');

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        threadIds: ['t1', 't2', 't3', 't4'],
        identityNames: ['Me'],
      },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(streamSpy).toHaveBeenCalledWith(['t1', 't2', 't3'], ['Me'], undefined);
    const data = res._getJSONData();
    expect(data.sessions).toHaveLength(3);
  });

  it('caps collected sessions at 20 and returns the last 5 sessions', async () => {
    memDb = createMemoryDb();
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    vi.spyOn(DatasetGenerator.prototype, 'generateRecords').mockImplementation(async function* () {
      for (let i = 1; i <= 25; i++) {
        yield {
          kind: 'session',
          entry: { messages: [{ role: 'user', content: `S${i}` }] },
        };
      }
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['t1'], identityNames: ['Me'] },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { sessions } = res._getJSONData();
    expect(sessions).toHaveLength(5);
    expect(sessions.map((s: { messages: Array<{ content: string }> }) => s.messages[0].content)).toEqual([
      'S16',
      'S17',
      'S18',
      'S19',
      'S20',
    ]);
  });

  it('previews CustomGPT Facebook event markdown output cleanly without JSON parse 500', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, {
      id: 'evt_1',
      platform: 'facebook',
      title: 'Team Offsite',
      labels: ['event'],
    });
    seedMessage(memDb, {
      thread_id: 'evt_1',
      sender_name: 'Me',
      timestamp_ms: 1700000000000,
      content: 'Created Event',
    });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        threadIds: ['fb-event-owned'],
        identityNames: ['Me'],
        skipSystemMessages: true,
      },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { sessions } = res._getJSONData();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages[0].role).toBe('assistant');
    expect(sessions[0].messages[0].content).toContain('Team Offsite');
  });

  it('returns 500 when preview generation fails', async () => {
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('DB unavailable');
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['t1'], identityNames: ['Me'] },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error', details: 'DB unavailable' });
  });
});
