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
 * Executes index-driven FTS5 + SQL `LIKE` search across message content, thread titles, and sender names
 * using `parseSearchQuery` (`OR` groups, quoted phrases, `^` word-start, `*`/`?` wildcards).
 * Materializes candidate IDs once per request in a temp table and returns paginated HTML-stripped context snippets
 * alongside optional self-excluding platform/category facets and top-20 consolidated sender counts.
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

  // Scroll pagination passes includeFacets=0 to skip redundant facet aggregations after page 1.
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
      // Bounded covering-index probe on idx_content_thread_id: short-circuits empty/missing
      // threads immediately and routes small thread scopes away from global FTS5 + CTE work.
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

    // Execute all temp-table DDL/queries synchronously before any `await` so the singleton DB connection
    // never overlaps temp._search_base across requests.
    try {
      dbInstance.exec('DROP TABLE IF EXISTS temp._search_base');
      dbInstance.exec(CREATE_SEARCH_BASE_TEMP_TABLE_SQL);

      const insertInfo = dbInstance.prepare(populateQuery.sql).run(...populateQuery.params);

      if (insertInfo.changes > 0) {
        if (includeFacets) {
          // Self-excluding facets: platform counts ignore the platform filter (only checking category),
          // and category counts ignore the category filter (only checking platform).
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
            // When no platform filter is active, matches_platform is 1 for all rows, so total
            // equals the sum of the platform facet counts without running another count query.
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
          // Paginate temp._search_base before joining content so large HTML bodies are read only
          // for the current page; repeat ORDER BY on the outer query since SQLite join order is unspecified.
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
        // Ignore cleanup errors to preserve any primary query exception.
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
      // Process Senders (Me vs Others)
      const myNames = await getMyNames();
      const myNamesSet = new Set(myNames.map((n) => n.toLowerCase()));

      // Prefer human-readable names over emails/phones for display
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

      // Clean HTML for Gmail and HTML-heavy content
      if (row.platform === 'google_mail' || snippet.includes('<') || snippet.includes('&')) {
        snippet = stripHtml(snippet);
      }

      // Generate context-aware snippet that centers on the search query
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
