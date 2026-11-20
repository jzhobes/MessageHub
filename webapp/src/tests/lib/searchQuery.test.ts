import { afterEach, describe, expect, it } from 'vitest';

import { buildPopulateSearchBaseQuery, CREATE_SEARCH_BASE_TEMP_TABLE_SQL } from '@/lib/server/searchQuery';
import { parseSearchQuery } from '@/lib/shared/search';
import { createMemoryDb, seedMessage, seedThread } from '@/tests/helpers/testDb';

import type Database from 'better-sqlite3';

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
`;

function createSearchDb(): Database.Database {
  const memDb = createMemoryDb();
  memDb.exec(FTS_DDL);
  seedThread(memDb, {
    id: 't1',
    platform: 'google_mail',
    title: 'Project Email',
    labels: ['inbox'],
  });
  seedMessage(memDb, {
    thread_id: 't1',
    sender_name: 'Alice',
    timestamp_ms: 1000,
    content: 'This is a test email message.',
  });
  memDb.exec(CREATE_SEARCH_BASE_TEMP_TABLE_SQL);
  return memDb;
}

describe('buildPopulateSearchBaseQuery', () => {
  const openDbs: Database.Database[] = [];

  afterEach(() => {
    while (openDbs.length > 0) {
      openDbs.pop()?.close();
    }
  });

  it.each(['test', 'test email', 'test OR email', '^test'])(
    'uses indexed plans without full content table scans for "%s"',
    (queryStr) => {
      const memDb = createSearchDb();
      openDbs.push(memDb);

      const { orGroups } = parseSearchQuery(queryStr);
      const built = buildPopulateSearchBaseQuery({
        orGroups,
        threadIds: [],
        platforms: [],
        categories: [],
        includeFacets: true,
      });

      const plan = memDb.prepare(`EXPLAIN QUERY PLAN ${built.sql}`).all(...built.params) as { detail: string }[];
      const details = plan.map((row) => row.detail);

      expect(details.some((d) => d.includes('content_fts'))).toBe(true);
      expect(details.some((d) => d.includes('idx_content_thread_id'))).toBe(true);
      expect(details.some((d) => d.includes('idx_content_sender_name'))).toBe(true);
      expect(details.some((d) => d.includes('sqlite_autoindex_content_1'))).toBe(false);
      expect(details.some((d) => /^SCAN (content|m)$/.test(d))).toBe(false);
    },
  );

  it('handles empty orGroups safely without inserting rows', () => {
    const memDb = createSearchDb();
    openDbs.push(memDb);

    const built = buildPopulateSearchBaseQuery({
      orGroups: [],
      threadIds: [],
      platforms: [],
      categories: [],
      includeFacets: true,
    });

    const info = memDb.prepare(built.sql).run(...built.params);
    expect(info.changes).toBe(0);
  });

  it('uses direct thread index scan without content_fts or full threads scan when useDirectThreadScope is true', () => {
    const memDb = createSearchDb();
    openDbs.push(memDb);

    const { orGroups } = parseSearchQuery('test email');
    const built = buildPopulateSearchBaseQuery({
      orGroups,
      threadIds: ['t1'],
      platforms: [],
      categories: [],
      includeFacets: true,
      useDirectThreadScope: true,
    });

    expect(built.sql).not.toContain('content_fts');
    expect(built.sql).not.toContain('_distinct_senders');

    const plan = memDb.prepare(`EXPLAIN QUERY PLAN ${built.sql}`).all(...built.params) as { detail: string }[];
    const details = plan.map((row) => row.detail);

    expect(details.some((d) => d.includes('content_fts'))).toBe(false);
    expect(details.some((d) => /^SCAN threads\b/.test(d))).toBe(false);
    expect(details.some((d) => d.includes('thread_id=?'))).toBe(true);
  });

  it('restricts threads lookup by primary key when useDirectThreadScope is false with threadIds', () => {
    const memDb = createSearchDb();
    openDbs.push(memDb);

    const { orGroups } = parseSearchQuery('test');
    const built = buildPopulateSearchBaseQuery({
      orGroups,
      threadIds: ['t1'],
      platforms: [],
      categories: [],
      includeFacets: true,
      useDirectThreadScope: false,
    });

    const plan = memDb.prepare(`EXPLAIN QUERY PLAN ${built.sql}`).all(...built.params) as { detail: string }[];
    const details = plan.map((row) => row.detail);

    expect(details.some((d) => d.includes('content_fts'))).toBe(true);
    expect(details.some((d) => d.includes('sqlite_autoindex_threads_1'))).toBe(true);
    expect(details.some((d) => /^SCAN threads\b/.test(d))).toBe(false);
  });

  it('classifies FTS trigram fragments by Unicode code point count rather than UTF-16 length', () => {
    for (const shortUnicode of ['😀a', '😀😀']) {
      const { orGroups } = parseSearchQuery(shortUnicode);
      const built = buildPopulateSearchBaseQuery({
        orGroups,
        threadIds: [],
        platforms: [],
        categories: [],
        includeFacets: true,
      });
      expect(built.sql).not.toContain('content_fts MATCH');
    }

    for (const longUnicode of ['😀😀😀', 'afé']) {
      const { orGroups } = parseSearchQuery(longUnicode);
      const built = buildPopulateSearchBaseQuery({
        orGroups,
        threadIds: [],
        platforms: [],
        categories: [],
        includeFacets: true,
      });
      expect(built.sql).toContain('content_fts MATCH');
    }
  });
});
