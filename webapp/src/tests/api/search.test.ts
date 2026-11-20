import { createMocks } from 'node-mocks-http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import handler from '@/pages/api/search';
import { createMemoryDb, seedMessage, seedThread } from '@/tests/helpers/testDb';

import type Database from 'better-sqlite3';

// Run the integration queries against a real database.

// Mock identity lookup because host paths and permissions can vary
// even when the workspace is fixed.
vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn().mockResolvedValue(['Me', 'John Doe', 'Charlie Chen']),
}));

const FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
    content,
    content='content',
    content_rowid='id',
    tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS content_ai AFTER INSERT ON content BEGIN
    INSERT INTO content_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS content_ad AFTER DELETE ON content BEGIN
    INSERT INTO content_fts(content_fts, rowid, content) VALUES('delete', old.id, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS content_au AFTER UPDATE ON content BEGIN
    INSERT INTO content_fts(content_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO content_fts(rowid, content) VALUES (new.id, new.content);
  END;
`;

function createSearchMemoryDb(): Database.Database {
  const memDb = createMemoryDb();
  memDb.exec(FTS_DDL);
  return memDb;
}

describe('/api/search (Integration)', () => {
  it('applies read-optimization pragmas on DatabaseService.get()', () => {
    const conn = db.get();
    expect(conn.pragma('cache_size', { simple: true })).toBe(-64000);
    expect(conn.pragma('temp_store', { simple: true })).toBe(2);
    expect(conn.pragma('mmap_size', { simple: true })).toBe(268435456);
  });

  it('should return 400 if query is missing', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('finds a Fern House weekend message via FTS', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'millbrook two bedrooms' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();

    expect(data.data).toContainEqual(
      expect.objectContaining({
        thread_id: 'cabin-weekend_1',
        content: expect.stringContaining('Found Fern House in Millbrook. Two bedrooms'),
      }),
    );
  });

  it('should filter by platform=google_mail', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'fern house', platform: 'google_mail' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();

    expect(data.total).toBeGreaterThan(0);
    expect(data.data).toContainEqual(expect.objectContaining({ thread_id: 'gm_8014' }));
    expect(data.data.every((result: { platform: string }) => result.platform === 'google_mail')).toBe(true);
  });

  it('should return correct facets', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'the' }, // High frequency word
    });

    await handler(req, res);
    const data = res._getJSONData();

    expect(data.facets.platforms).toHaveProperty('facebook');
    expect(data.facets.platforms).toHaveProperty('google_mail');
    // Ensure counts are numbers
    expect(typeof data.facets.platforms.facebook).toBe('number');
  });
});

describe('/api/search (Query Semantics, Facets & Cleanup)', () => {
  let memDb: Database.Database | null = null;
  let existsSpy: ReturnType<typeof vi.spyOn> | null = null;
  let getSpy: ReturnType<typeof vi.spyOn> | null = null;

  function useMemoryDb(): Database.Database {
    memDb = createSearchMemoryDb();
    existsSpy = vi.spyOn(db, 'exists').mockReturnValue(true);
    getSpy = vi.spyOn(db, 'get').mockReturnValue(memDb);
    return memDb;
  }

  afterEach(() => {
    existsSpy?.mockRestore();
    getSpy?.mockRestore();
    existsSpy = null;
    getSpy = null;
    memDb?.close();
    memDb = null;
  });

  it('matches across content, thread title, and sender name including cross-field AND', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't_content', platform: 'facebook', title: 'General Chat', labels: ['message'] });
    seedThread(d, { id: 't_title', platform: 'google_mail', title: 'Quarterly Budget', labels: ['inbox'] });
    seedThread(d, { id: 't_sender', platform: 'google_chat', title: 'Random Room', labels: ['dm'] });

    const id1 = seedMessage(d, {
      thread_id: 't_content',
      sender_name: 'Bob',
      timestamp_ms: 1000,
      content: 'Looking at the budget numbers',
    });
    const id2 = seedMessage(d, {
      thread_id: 't_title',
      sender_name: 'Alice',
      timestamp_ms: 2000,
      content: 'Please review attached sheet',
    });
    const id3 = seedMessage(d, {
      thread_id: 't_sender',
      sender_name: 'Budget Bot',
      timestamp_ms: 3000,
      content: 'Daily notification ping',
    });

    // Single term matching all 3 fields across different rows
    const { req: req1, res: res1 } = createMocks({ method: 'GET', query: { q: 'budget' } });
    await handler(req1, res1);
    expect(res1._getStatusCode()).toBe(200);
    const data1 = res1._getJSONData();
    expect(data1.total).toBe(3);
    expect(data1.data.map((r: { message_id: number }) => r.message_id)).toEqual([id3, id2, id1]);

    // Cross-field AND: sender + content
    const { req: req2, res: res2 } = createMocks({ method: 'GET', query: { q: 'budget notification' } });
    await handler(req2, res2);
    expect(res2._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id3]);

    // Cross-field AND: title + content
    const { req: req3, res: res3 } = createMocks({ method: 'GET', query: { q: 'quarterly sheet' } });
    await handler(req3, res3);
    expect(res3._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id2]);
  });

  it('supports OR boolean groups and quoted phrases', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't1', platform: 'facebook', title: 'Chat', labels: ['message'] });

    const id1 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 100, content: 'alpha beta' });
    const id2 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 200, content: 'gamma delta' });
    const id3 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 300, content: 'alpha only' });
    const id4 = seedMessage(d, {
      thread_id: 't1',
      sender_name: 'A',
      timestamp_ms: 400,
      content: 'this is an exact phrase match',
    });
    seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 500, content: 'phrase exact out of order' });

    const { req: reqOr, res: resOr } = createMocks({ method: 'GET', query: { q: 'alpha beta OR gamma' } });
    await handler(reqOr, resOr);
    expect(resOr._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id2, id1]);

    const { req: reqOrSimple, res: resOrSimple } = createMocks({ method: 'GET', query: { q: 'alpha OR gamma' } });
    await handler(reqOrSimple, resOrSimple);
    expect(resOrSimple._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id3, id2, id1]);

    const { req: reqPhrase, res: resPhrase } = createMocks({ method: 'GET', query: { q: '"exact phrase"' } });
    await handler(reqPhrase, resPhrase);
    expect(resPhrase._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id4]);
  });

  it('enforces ^start word-start matching without false mid-word matches', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't1', platform: 'facebook', title: 'Chat', labels: ['message'] });

    const idStart = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 100, content: 'test one' });
    const idSpace = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 200, content: 'hello test two' });
    const idNewline = seedMessage(d, {
      thread_id: 't1',
      sender_name: 'A',
      timestamp_ms: 300,
      content: 'hello\ntest three',
    });
    seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 400, content: 'this is a contest entry' });

    const { req, res } = createMocks({ method: 'GET', query: { q: '^test' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.total).toBe(3);
    expect(data.data.map((r: { message_id: number }) => r.message_id)).toEqual([idNewline, idSpace, idStart]);
  });

  it('handles wildcards (* and ?), mixed short+indexable AND, short-only, and whitespace queries', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't1', platform: 'facebook', title: 'Chat', labels: ['message'] });

    const id1 = seedMessage(d, {
      thread_id: 't1',
      sender_name: 'A',
      timestamp_ms: 100,
      content: 'hi matrix testing team',
    });
    const id2 = seedMessage(d, {
      thread_id: 't1',
      sender_name: 'A',
      timestamp_ms: 200,
      content: 'teXting and teast message',
    });
    const id3 = seedMessage(d, {
      thread_id: 't1',
      sender_name: 'A',
      timestamp_ms: 300,
      content: 'hi matrix only',
    });

    // Check the two short fragments in te*st through LIKE, then check an indexable wildcard.
    const { req: rWild1, res: resWild1 } = createMocks({ method: 'GET', query: { q: 'te*st' } });
    await handler(rWild1, resWild1);
    expect(resWild1._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id2, id1]);

    // Use te?ting to exercise an indexable fragment with a single-character wildcard.
    const { req: rWild2, res: resWild2 } = createMocks({ method: 'GET', query: { q: 'te?ting' } });
    await handler(rWild2, resWild2);
    expect(resWild2._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id2, id1]);

    // Non-indexable ? wildcard (te?t)
    const { req: rWild3, res: resWild3 } = createMocks({ method: 'GET', query: { q: 'te?t' } });
    await handler(rWild3, resWild3);
    expect(resWild3._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id2, id1]);

    // Combine a term that hits the index with one too short for it.
    const { req: rMixed, res: resMixed } = createMocks({ method: 'GET', query: { q: 'hi matrix' } });
    await handler(rMixed, resMixed);
    expect(resMixed._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id3, id1]);

    // Short-only (<3 char)
    const { req: rShort, res: resShort } = createMocks({ method: 'GET', query: { q: 'hi' } });
    await handler(rShort, resShort);
    expect(resShort._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id3, id1]);

    // Whitespace-only query
    const { req: rEmpty, res: resEmpty } = createMocks({ method: 'GET', query: { q: '   ' } });
    await handler(rEmpty, resEmpty);
    expect(resEmpty._getStatusCode()).toBe(200);
    expect(resEmpty._getJSONData()).toEqual({
      data: [],
      total: 0,
      facets: { platforms: {}, categories: {}, senders: {} },
    });
  });

  it('computes self-excluding facets when both platform and category filters are active and filters by threadId', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't_fb_msg', platform: 'facebook', title: 'FB', labels: ['message'] });
    seedThread(d, { id: 't_gm_in', platform: 'google_mail', title: 'GM In', labels: ['inbox'] });
    seedThread(d, { id: 't_gm_sent', platform: 'google_mail', title: 'GM Sent', labels: ['sent'] });
    seedThread(d, { id: 't_gc_in', platform: 'google_chat', title: 'GC In', labels: ['inbox'] });

    seedMessage(d, { thread_id: 't_fb_msg', sender_name: 'Alice', timestamp_ms: 100, content: 'signal check' });
    const targetId = seedMessage(d, {
      thread_id: 't_gm_in',
      sender_name: 'Bob',
      timestamp_ms: 200,
      content: 'signal check',
    });
    seedMessage(d, { thread_id: 't_gm_sent', sender_name: 'Carol', timestamp_ms: 300, content: 'signal check' });
    seedMessage(d, { thread_id: 't_gc_in', sender_name: 'Dave', timestamp_ms: 400, content: 'signal check' });

    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'signal', platform: 'google_mail', type: 'inbox' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();

    // Apply both filters to hits, the total, and sender counts.
    expect(data.total).toBe(1);
    expect(data.data.map((r: { message_id: number }) => r.message_id)).toEqual([targetId]);
    expect(data.facets.senders).toEqual({ Bob: 1 });

    // Count platforms across inbox results even with a platform selected.
    expect(data.facets.platforms).toEqual({ google_mail: 1, google_chat: 1 });

    // Count categories across Gmail results even with a category selected.
    expect(data.facets.categories).toEqual({ inbox: 1, sent: 1 });

    // threadId filter
    const { req: reqThread, res: resThread } = createMocks({
      method: 'GET',
      query: { q: 'signal', threadId: 't_gc_in' },
    });
    await handler(reqThread, resThread);
    const threadData = resThread._getJSONData();
    expect(threadData.total).toBe(1);
    expect(threadData.data[0].thread_id).toBe('t_gc_in');
  });

  it('omits facets when includeFacets=0 across page=1 and page=2 while preserving accurate totals', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't1', platform: 'facebook', title: 'Bulk', labels: ['message'] });
    seedThread(d, { id: 't2', platform: 'google_mail', title: 'Other', labels: ['inbox'] });

    for (let i = 1; i <= 105; i++) {
      seedMessage(d, {
        thread_id: 't1',
        sender_name: 'Alice',
        timestamp_ms: i * 1000,
        content: `paginated keyword item ${i}`,
      });
    }
    seedMessage(d, {
      thread_id: 't2',
      sender_name: 'Bob',
      timestamp_ms: 999999,
      content: 'paginated keyword excluded by platform filter',
    });

    const { req: r1, res: res1 } = createMocks({
      method: 'GET',
      query: { q: 'paginated', platform: 'facebook', page: '1', includeFacets: '0' },
    });
    await handler(r1, res1);
    expect(res1._getStatusCode()).toBe(200);
    const p1 = res1._getJSONData();
    expect(p1.total).toBe(105);
    expect(p1.data).toHaveLength(100);
    expect(p1.facets).toBeUndefined();

    const { req: r2, res: res2 } = createMocks({
      method: 'GET',
      query: { q: 'paginated', platform: 'facebook', page: '2', includeFacets: '0' },
    });
    await handler(r2, res2);
    expect(res2._getStatusCode()).toBe(200);
    const p2 = res2._getJSONData();
    expect(p2.total).toBe(105);
    expect(p2.data).toHaveLength(5);
    expect(p2.facets).toBeUndefined();
    expect(p2.data[0].timestamp).toBe(5000);
    expect(p2.data[4].timestamp).toBe(1000);
  });

  it('always cleans up temp._search_base after completion and on error', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't1', platform: 'facebook', title: 'Chat', labels: ['message'] });
    seedMessage(d, { thread_id: 't1', sender_name: 'Alice', timestamp_ms: 100, content: 'cleanup test row' });

    const { req, res } = createMocks({ method: 'GET', query: { q: 'cleanup' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const tempAfterSuccess = d
      .prepare("SELECT name FROM sqlite_temp_master WHERE type='table' AND name='_search_base'")
      .get();
    expect(tempAfterSuccess).toBeUndefined();

    // Drop content_fts so the query fails after creating its temp table.
    d.exec('DROP TABLE content_fts');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { req: reqErr, res: resErr } = createMocks({ method: 'GET', query: { q: 'cleanup' } });
      await handler(reqErr, resErr);
      expect(resErr._getStatusCode()).toBe(500);
    } finally {
      errorSpy.mockRestore();
    }

    const tempAfterError = d
      .prepare("SELECT name FROM sqlite_temp_master WHERE type='table' AND name='_search_base'")
      .get();
    expect(tempAfterError).toBeUndefined();
  });

  it('matches short Unicode/emoji queries accurately across LIKE fallback and FTS5', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't1', platform: 'facebook', title: 'Emoji Chat', labels: ['message'] });

    const id1 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 100, content: 'hello 😀a world' });
    const id2 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 200, content: 'hello 😀b world' });
    const id3 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 300, content: 'hello 😀😀 world' });
    const id4 = seedMessage(d, { thread_id: 't1', sender_name: 'A', timestamp_ms: 400, content: 'hello 😀😀😀 world' });

    const { req: r1, res: res1 } = createMocks({ method: 'GET', query: { q: '😀a' } });
    await handler(r1, res1);
    expect(res1._getStatusCode()).toBe(200);
    expect(res1._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id1]);

    const { req: r2, res: res2 } = createMocks({ method: 'GET', query: { q: '😀😀' } });
    await handler(r2, res2);
    expect(res2._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id4, id3]);

    const { req: r3, res: res3 } = createMocks({ method: 'GET', query: { q: '😀😀😀' } });
    await handler(r3, res3);
    expect(res3._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id4]);

    const { req: rMixed, res: resMixed } = createMocks({ method: 'GET', query: { q: '😀a world' } });
    await handler(rMixed, resMixed);
    expect(resMixed._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id1]);

    const { req: rWild, res: resWild } = createMocks({ method: 'GET', query: { q: '😀a*world' } });
    await handler(rWild, resWild);
    expect(resWild._getJSONData().data.map((r: { message_id: number }) => r.message_id)).toEqual([id1]);

    // Confirm id2 stays out of the results for 😀a.
    expect(id2).toBeGreaterThan(id1);
  });

  it('scopes small, missing, and faceted threadId queries cleanly', async () => {
    const d = useMemoryDb();
    seedThread(d, { id: 't_target', platform: 'google_mail', title: 'Target Thread', labels: ['inbox'] });
    seedThread(d, { id: 't_other', platform: 'facebook', title: 'Alice Other', labels: ['message'] });

    const targetMatchId = seedMessage(d, {
      thread_id: 't_target',
      sender_name: 'Bob',
      timestamp_ms: 100,
      content: 'common thread note',
    });
    seedMessage(d, {
      thread_id: 't_other',
      sender_name: 'Alice',
      timestamp_ms: 200,
      content: 'common elsewhere',
    });

    // The scoped thread should return nothing even when another thread matches both terms.
    const { req: rZero, res: resZero } = createMocks({
      method: 'GET',
      query: { q: 'Alice common', threadId: 't_target' },
    });
    await handler(rZero, resZero);
    expect(resZero._getStatusCode()).toBe(200);
    expect(resZero._getJSONData()).toEqual({
      data: [],
      total: 0,
      facets: { platforms: {}, categories: {}, senders: {} },
    });

    // Matching scoped query with facets
    const { req: rHit, res: resHit } = createMocks({
      method: 'GET',
      query: { q: 'common', threadId: 't_target', platform: 'google_mail', type: 'inbox' },
    });
    await handler(rHit, resHit);
    expect(resHit._getStatusCode()).toBe(200);
    const hitData = resHit._getJSONData();
    expect(hitData.total).toBe(1);
    expect(hitData.data.map((r: { message_id: number }) => r.message_id)).toEqual([targetMatchId]);
    expect(hitData.facets).toEqual({
      platforms: { google_mail: 1 },
      categories: { inbox: 1 },
      senders: { Bob: 1 },
    });

    // A missing thread should return early with facets on or off.
    const { req: rMissing, res: resMissing } = createMocks({
      method: 'GET',
      query: { q: 'common', threadId: 'does_not_exist' },
    });
    await handler(rMissing, resMissing);
    expect(resMissing._getStatusCode()).toBe(200);
    expect(resMissing._getJSONData()).toEqual({
      data: [],
      total: 0,
      facets: { platforms: {}, categories: {}, senders: {} },
    });

    const { req: rMissingNoFacets, res: resMissingNoFacets } = createMocks({
      method: 'GET',
      query: { q: 'common', threadId: 'does_not_exist', includeFacets: '0' },
    });
    await handler(rMissingNoFacets, resMissingNoFacets);
    expect(resMissingNoFacets._getStatusCode()).toBe(200);
    expect(resMissingNoFacets._getJSONData()).toEqual({ data: [], total: 0 });
  });
});
