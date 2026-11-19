// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import handler from '@/pages/api/status';

import { createMemoryDb, seedThread } from '../helpers/testDb';

import type Database from 'better-sqlite3';

describe('/api/status', () => {
  let memDb: Database.Database | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (memDb) {
      memDb.close();
      memDb = null;
    }
  });

  it('returns initialized=false and all platforms false when DB does not exist', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      initialized: false,
      platforms: {
        facebook: false,
        instagram: false,
        google_chat: false,
        google_voice: false,
        google_mail: false,
      },
    });
  });

  it('returns initialized=true and per-platform availability based on threads table', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 't1', platform: 'facebook', title: 'FB' });
    seedThread(memDb, { id: 't2', platform: 'google_mail', title: 'Mail' });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      initialized: true,
      platforms: {
        facebook: true,
        instagram: false,
        google_chat: false,
        google_voice: false,
        google_mail: true,
      },
    });
  });

  it('returns 500 when querying database throws', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('Corrupt DB');
    });

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ status: 'error', message: 'Database query failed' });
  });
});
