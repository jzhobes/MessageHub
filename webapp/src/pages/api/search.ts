import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import {
  buildPopulateSearchBaseQuery,
  CREATE_SEARCH_BASE_TEMP_TABLE_SQL,
  DIRECT_THREAD_SCOPE_LIMIT,
} from '@/lib/server/searchQuery';
import { PlatformMap, ReversePlatformMap } from '@/lib/shared/platforms';
import { parseSearchQuery } from '@/lib/shared/search';
import { generateContextSnippet, stripHtml } from '@/lib/shared/stringUtils';

import type { NextApiRequest, NextApiResponse } from 'next';

interface SearchRow {
  id: number;
  thread_id: string;
  thread_title: string | null;
  platform: string;
  sender_name: string;
  timestamp_ms: number;
  content: string;
}

/**
 * Search message bodies, thread titles, and sender names with FTS5 and `LIKE`. The parser handles
 * `OR`, quotes, `^` word starts, and `*`/`?` wildcards.
 * Collect candidate IDs once in a temp table. Return a page of plain-text snippets and, when
 * requested, self-excluding platform/category facets and the top 20 consolidated sender counts.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { q, page = '1', platform, threadId } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing search query' });
  }

  const queryStr = q;
  const pageNum = Math.max(1, parseInt(Array.isArray(page) ? page[0] : page, 10) || 1);
  const PAGE_SIZE = 100;
  const offset = (pageNum - 1) * PAGE_SIZE;

  // Scroll requests pass includeFacets=0 because page 1 already has the counts.
  const includeFacetsParam = Array.isArray(req.query.includeFacets)
    ? req.query.includeFacets[0]
    : req.query.includeFacets;
  const includeFacets = includeFacetsParam !== '0' && includeFacetsParam !== 'false';

  try {
    if (!db.exists()) {
      return res.status(200).json({
        data: [],
        total: 0,
        ...(includeFacets ? { facets: { platforms: {}, categories: {}, senders: {} } } : {}),
      });
    }

    const { orGroups } = parseSearchQuery(queryStr);
    if (orGroups.length === 0) {
      return res.status(200).json({
        data: [],
        total: 0,
        ...(includeFacets ? { facets: { platforms: {}, categories: {}, senders: {} } } : {}),
      });
    }

    // platform filter
    const platformInputs = platform ? (Array.isArray(platform) ? platform : [platform]) : [];
    const validDbPlatforms = platformInputs.reduce((acc, raw) => {
      const dbValue = ReversePlatformMap[raw] || (PlatformMap[raw] ? raw : null);
      if (dbValue) {
        acc.push(dbValue);
      }
      return acc;
    }, [] as string[]);

    // category filter
    const typeInputs = req.query.type ? (Array.isArray(req.query.type) ? req.query.type : [req.query.type]) : [];
    const validCategories = typeInputs.filter(Boolean);

    const threadInputs = threadId ? (Array.isArray(threadId) ? threadId : [threadId]) : [];
    const validThreadIds = threadInputs.filter(Boolean);

    const dbInstance = db.get();

    let useDirectThreadScope = false;
    if (validThreadIds.length > 0) {
      // Check the thread through idx_content_thread_id with a bounded probe.
      // That catches empty or missing threads and lets small ones skip global FTS5 and the CTEs.
      const threadPlaceholders = validThreadIds.map(() => '?').join(',');
      const probeRow = dbInstance
        .prepare(
          `SELECT count(*) as count FROM (SELECT 1 FROM content WHERE thread_id IN (${threadPlaceholders}) LIMIT ?)`,
        )
        .get(...validThreadIds, DIRECT_THREAD_SCOPE_LIMIT + 1) as { count: number };

      if (probeRow.count === 0) {
        return res.status(200).json({
          data: [],
          total: 0,
          ...(includeFacets ? { facets: { platforms: {}, categories: {}, senders: {} } } : {}),
        });
      }
      useDirectThreadScope = probeRow.count <= DIRECT_THREAD_SCOPE_LIMIT;
    }

    const populateQuery = buildPopulateSearchBaseQuery({
      orGroups,
      threadIds: validThreadIds,
      platforms: validDbPlatforms,
      categories: validCategories,
      includeFacets,
      useDirectThreadScope,
    });

    let total = 0;
    let platformRows: { platform: string; count: number }[] = [];
    let categoryRows: { label: string; count: number }[] = [];
    let senderRows: { sender_name: string; count: number }[] = [];
    let dataRows: SearchRow[] = [];

    // Finish all temp-table work before the first await.
    // That keeps requests from overlapping on temp._search_base on the shared SQLite connection.
    try {
      dbInstance.exec('DROP TABLE IF EXISTS temp._search_base');
      dbInstance.exec(CREATE_SEARCH_BASE_TEMP_TABLE_SQL);

      const insertInfo = dbInstance.prepare(populateQuery.sql).run(...populateQuery.params);

      if (insertInfo.changes > 0) {
        if (includeFacets) {
          // Count platforms using the category filter only.
          // Count categories using the platform filter only.
          platformRows = dbInstance
            .prepare(
              `SELECT platform, count(*) as count
               FROM temp._search_base
               WHERE matches_category = 1
               GROUP BY platform`,
            )
            .all() as { platform: string; count: number }[];

          categoryRows = dbInstance
            .prepare(
              `SELECT tl.label, count(*) as count
               FROM temp._search_base s
               INNER JOIN thread_labels tl ON s.thread_id = tl.thread_id
               WHERE s.matches_platform = 1
               GROUP BY tl.label`,
            )
            .all() as { label: string; count: number }[];

          if (validDbPlatforms.length === 0) {
            // With no platform filter, every row has matches_platform = 1.
            // Sum the platform facets for the total and skip a separate count query.
            total = platformRows.reduce((sum, r) => sum + r.count, 0);
          } else {
            const countResult = dbInstance
              .prepare(
                `SELECT count(*) as total
                 FROM temp._search_base
                 WHERE matches_platform = 1 AND matches_category = 1`,
              )
              .get() as { total: number } | undefined;
            total = countResult ? countResult.total : 0;
          }

          senderRows = dbInstance
            .prepare(
              `SELECT sender_name, count(*) as count
               FROM temp._search_base
               WHERE matches_platform = 1 AND matches_category = 1
               GROUP BY sender_name
               ORDER BY count DESC
               LIMIT 20`,
            )
            .all() as { sender_name: string; count: number }[];
        } else {
          total = insertInfo.changes;
        }

        if (total > 0 && offset < total) {
          // Page the temp table first so we only read HTML bodies for this page.
          // Repeat ORDER BY outside the join because SQLite can reorder joined rows.
          dataRows = dbInstance
            .prepare(
              `SELECT m.id, m.thread_id, m.sender_name, m.timestamp_ms, m.content, s.platform, t.title as thread_title
               FROM (
                 SELECT id, thread_id, platform
                 FROM temp._search_base
                 WHERE matches_platform = 1 AND matches_category = 1
                 ORDER BY timestamp_ms DESC
                 LIMIT ? OFFSET ?
               ) s
               JOIN content m ON m.id = s.id
               JOIN threads t ON s.thread_id = t.id
               ORDER BY m.timestamp_ms DESC`,
            )
            .all(PAGE_SIZE, offset) as SearchRow[];
        }
      }
    } finally {
      try {
        dbInstance.exec('DROP TABLE IF EXISTS temp._search_base');
      } catch {
        // Keep the original query error if cleanup also fails.
      }
    }

    const platforms = platformRows.reduce(
      (acc, r) => {
        acc[r.platform] = r.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    const categories = categoryRows.reduce(
      (acc, r) => {
        if (r.label) {
          acc[r.label] = r.count;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    let sortedSenders: Record<string, number> = {};
    if (includeFacets && senderRows.length > 0) {
      // Group sender aliases under Me or the matching participant.
      const myNames = await getMyNames();
      const myNamesSet = new Set(myNames.map((n) => n.toLowerCase()));

      // Prefer a readable name over an email address or phone number.
      const humanReadableNames = myNames.filter((n) => !n.includes('@') && !n.startsWith('+'));
      const meDisplayName =
        (humanReadableNames.length > 0
          ? [...humanReadableNames].sort((a, b) => b.length - a.length)[0]
          : [...myNames].sort((a, b) => b.length - a.length)[0]) || 'Me';

      const senders: Record<string, number> = {};
      let meCount = 0;
      senderRows.forEach((r) => {
        const name = r.sender_name || 'Unknown';
        if (myNamesSet.has(name.toLowerCase())) {
          meCount += r.count;
        } else {
          senders[name] = (senders[name] || 0) + r.count;
        }
      });
      if (meCount > 0) {
        senders[meDisplayName] = meCount;
      }
      sortedSenders = Object.fromEntries(Object.entries(senders).sort((a, b) => b[1] - a[1]));
    }

    const results = dataRows.map((row) => {
      let snippet = row.content || '';

      // Strip markup from Gmail and other HTML-heavy messages.
      if (row.platform === 'google_mail' || snippet.includes('<') || snippet.includes('&')) {
        snippet = stripHtml(snippet);
      }

      // Put the match in context so the snippet shows why it came back.
      snippet = generateContextSnippet(snippet, queryStr, 300);

      return {
        message_id: row.id,
        thread_id: row.thread_id,
        thread_title: row.thread_title,
        platform: row.platform,
        sender_name: row.sender_name,
        timestamp: row.timestamp_ms,
        content: row.content,
        snippet,
      };
    });

    return res.status(200).json({
      data: results,
      total,
      ...(includeFacets
        ? {
            facets: {
              platforms,
              categories,
              senders: sortedSenders,
            },
          }
        : {}),
    });
  } catch (e) {
    console.error('Error searching:', e);
    return res.status(500).json({ error: 'Failed to search' });
  }
}
