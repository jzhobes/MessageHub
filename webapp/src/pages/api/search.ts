import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { PlatformMap, ReversePlatformMap } from '@/lib/shared/platforms';
import { parseSearchQuery } from '@/lib/shared/search';
import { decodeHtmlEntities, generateContextSnippet, stripHtml } from '@/lib/shared/stringUtils';

import type { NextApiRequest, NextApiResponse } from 'next';

interface SearchRow {
  id: number;
  thread_id: string;
  thread_title: string | null;
  platform: string;
  sender_name: string;
  timestamp_ms: number;
  content: string;
  search_snippet?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { q, page = '1', platform, threadId } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing search query' });
  }

  const queryStr = q;
  const pageNum = parseInt(Array.isArray(page) ? page[0] : page, 10) || 1;
  const PAGE_SIZE = 100;
  const offset = (pageNum - 1) * PAGE_SIZE;

  try {
    if (!db.exists()) {
      return res.status(200).json({ data: [], total: 0, facets: { platforms: {}, categories: {}, senders: {} } });
    }

    // Tokenize query with OR support
    const parsedQuery = parseSearchQuery(queryStr);
    const { orGroups } = parsedQuery;

    // Build matching logic for each OR group
    const orGroupConditions: string[] = [];
    const orGroupFtsMatches: string[] = [];
    const allLikeParams: (string | number)[] = [];

    for (const tokens of orGroups) {
      // Build conditions for this AND group
      const { matchTokens, likeConditions, likeParams } = tokens.reduce(
        (acc, token) => {
          const { clean, isStartOfWord, sqlPattern } = token;

          const ftsParts = clean.split(/[*?^]/).filter((p) => p.trim().length >= 3);
          ftsParts.forEach((part) => {
            acc.matchTokens.push(`"${part.replace(/"/g, '""')}"`);
          });

          const contentLikes = isStartOfWord
            ? `(m.content LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')`
            : `m.content LIKE ? ESCAPE '\\'`;
          const titleLikes = isStartOfWord
            ? `(t.title LIKE ? ESCAPE '\\' OR t.title LIKE ? ESCAPE '\\')`
            : `t.title LIKE ? ESCAPE '\\'`;
          const senderLikes = isStartOfWord
            ? `(m.sender_name LIKE ? ESCAPE '\\' OR m.sender_name LIKE ? ESCAPE '\\')`
            : `m.sender_name LIKE ? ESCAPE '\\'`;

          acc.likeConditions.push(`(${contentLikes} OR ${titleLikes} OR ${senderLikes})`);

          if (isStartOfWord) {
            acc.likeParams.push(`${sqlPattern}%`, ` ${sqlPattern}%`, `\\n${sqlPattern}%`); // content
            acc.likeParams.push(`${sqlPattern}%`, ` ${sqlPattern}%`); // title
            acc.likeParams.push(`${sqlPattern}%`, ` ${sqlPattern}%`); // sender
          } else {
            acc.likeParams.push(`%${sqlPattern}%`, `%${sqlPattern}%`, `%${sqlPattern}%`);
          }
          return acc;
        },
        { matchTokens: [] as string[], likeConditions: [] as string[], likeParams: [] as (string | number)[] },
      );

      // Combine this group's conditions with AND
      if (likeConditions.length > 0) {
        orGroupConditions.push(`(${likeConditions.join(' AND ')})`);
        allLikeParams.push(...likeParams);
      }

      // Combine this group's FTS matches with AND
      if (matchTokens.length > 0) {
        orGroupFtsMatches.push(`(${matchTokens.join(' AND ')})`);
      }
    }

    // Combine all OR groups
    const ftsMatch = orGroupFtsMatches.length > 0 ? orGroupFtsMatches.join(' OR ') : '';
    const likeConditions = orGroupConditions;
    const likeParams = allLikeParams;

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

    // Construct combined where clause
    const matchAnyTitlePattern = `%${queryStr.replace(/[%_\\\\]/g, '\\\\$&')}%`;

    // We search across BOTH content and thread title + sender
    // FTS MATCH cannot be easily used with OR in joined queries, so we use a subquery for the ID match
    const ftsCondition = ftsMatch
      ? `(m.id IN (SELECT rowid FROM content_fts WHERE content_fts MATCH ?) OR t.title LIKE ? ESCAPE '\\' OR m.sender_name LIKE ? ESCAPE '\\')`
      : `(t.title LIKE ? ESCAPE '\\' OR m.sender_name LIKE ? ESCAPE '\\')`;

    // Combine FTS and LIKE conditions with OR (not AND!)
    const searchConditions = [ftsCondition, ...likeConditions].filter(Boolean);
    const combinedSearchCondition = searchConditions.length > 0 ? `(${searchConditions.join(' OR ')})` : '';

    const baseConditions = [
      combinedSearchCondition,
      validThreadIds.length > 0 ? `m.thread_id IN (${validThreadIds.map(() => '?').join(',')})` : '',
    ].filter(Boolean);

    const platformCondition =
      validDbPlatforms.length > 0 ? `t.platform IN (${validDbPlatforms.map(() => '?').join(',')})` : '';
    const categoryCondition =
      validCategories.length > 0
        ? `t.id IN (SELECT thread_id FROM thread_labels WHERE label IN (${validCategories.map(() => '?').join(',')}))`
        : '';

    const whereConditions = [...baseConditions];
    if (platformCondition) {
      whereConditions.push(platformCondition);
    }
    if (categoryCondition) {
      whereConditions.push(categoryCondition);
    }

    const filteredBase = `
      FROM content m
      JOIN threads t ON m.thread_id = t.id
      ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}
    `;

    const ftsParams = ftsMatch
      ? [ftsMatch, matchAnyTitlePattern, matchAnyTitlePattern]
      : [matchAnyTitlePattern, matchAnyTitlePattern];
    const baseParams = [...ftsParams, ...likeParams, ...validThreadIds];
    const finalParams = [...baseParams, ...validDbPlatforms, ...validCategories];

    // 1. Get total count
    const countResult = dbInstance.prepare(`SELECT count(*) as total ${filteredBase}`).get(...finalParams) as {
      total: number;
    };
    const total = countResult ? countResult.total : 0;

    // 2. Facets - platform (Exclude platform filter from this count so counts don't disappear)
    const platformFacetConditions = [...baseConditions];
    if (categoryCondition) {
      platformFacetConditions.push(categoryCondition);
    }
    const platformFacetBase = `
      FROM content m
      JOIN threads t ON m.thread_id = t.id
      ${platformFacetConditions.length > 0 ? 'WHERE ' + platformFacetConditions.join(' AND ') : ''}
    `;
    const platformFacetParams = [...baseParams, ...validCategories];
    const platformRows = dbInstance
      .prepare(`SELECT t.platform, count(*) as count ${platformFacetBase} GROUP BY t.platform`)
      .all(...platformFacetParams) as { platform: string; count: number }[];
    const platforms = platformRows.reduce(
      (acc, r) => {
        acc[r.platform] = r.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    // 3. Facets - category (Exclude category filter from this count so counts don't disappear)
    const categoryFacetConditions = [...baseConditions];
    if (platformCondition) {
      categoryFacetConditions.push(platformCondition);
    }
    const categoryFacetBase = `
      FROM content m
      JOIN threads t ON m.thread_id = t.id
      INNER JOIN thread_labels tl ON t.id = tl.thread_id
      ${categoryFacetConditions.length > 0 ? 'WHERE ' + categoryFacetConditions.join(' AND ') : ''}
    `;
    const categoryFacetParams = [...baseParams, ...validDbPlatforms];
    const categoryRows = dbInstance
      .prepare(`SELECT tl.label, count(*) as count ${categoryFacetBase} GROUP BY tl.label`)
      .all(...categoryFacetParams) as { label: string; count: number }[];
    const categories = categoryRows.reduce(
      (acc, r) => {
        if (r.label) {
          acc[r.label] = r.count;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    // 3. Facets - sender
    const senderRows = dbInstance
      .prepare(
        `SELECT m.sender_name, count(*) as count ${filteredBase} GROUP BY m.sender_name ORDER BY count DESC LIMIT 20`,
      )
      .all(...finalParams) as { sender_name: string; count: number }[];

    // 4. Data Results
    const selectClause = `SELECT m.*, t.platform, t.title as thread_title`;

    const dataSql = `${selectClause} ${filteredBase} ORDER BY m.timestamp_ms DESC LIMIT ? OFFSET ?`;
    const dataRows = dbInstance.prepare(dataSql).all(...finalParams, PAGE_SIZE, offset) as SearchRow[];

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
    const sortedSenders = Object.fromEntries(Object.entries(senders).sort((a, b) => b[1] - a[1]));

    const results = dataRows.map((row) => {
      let snippet = row.content || '';

      // Clean HTML for Gmail and HTML-heavy content
      if (row.platform === 'google_mail' || snippet.includes('<') || snippet.includes('&')) {
        snippet = decodeHtmlEntities(stripHtml(snippet));
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
      facets: {
        platforms,
        categories,
        senders: sortedSenders,
      },
    });
  } catch (e) {
    console.error('Error searching:', e);
    return res.status(500).json({ error: 'Failed to search' });
  }
}
