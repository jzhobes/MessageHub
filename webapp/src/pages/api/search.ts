import type { NextApiRequest, NextApiResponse } from 'next';
import db from '@/lib/server/db';
import { PlatformMap, ReversePlatformMap } from '@/lib/shared/platforms';
import { getMyNames } from '@/lib/server/identity';
import { parseSearchQuery } from '@/lib/shared/search';

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

    // Tokenize query
    const tokens = parseSearchQuery(queryStr);

    // Build matching logic
    const { matchTokens, likeConditions, likeParams } = tokens.reduce(
      (acc, token) => {
        const { clean, isStartOfWord, sqlPattern } = token;

        // Broad FTS filter
        // Split by wildcards and add each part as a separate match token to avoid phrase match issues.
        // We filter out parts shorter than 3 characters because FTS5 trigram doesn't support them efficiently/reliably for substrings.
        const ftsParts = clean.split(/[*?^]/).filter((p) => p.trim().length >= 3);
        ftsParts.forEach((part) => {
          acc.matchTokens.push(`"${part.replace(/"/g, '""')}"`);
        });

        if (isStartOfWord) {
          acc.likeConditions.push(
            `(m.content LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')`,
          );
          acc.likeParams.push(`${sqlPattern}%`, `% ${sqlPattern}%`, `%\n${sqlPattern}%`);
        } else {
          acc.likeConditions.push(`m.content LIKE ? ESCAPE '\\'`);
          acc.likeParams.push(`%${sqlPattern}%`);
        }
        return acc;
      },
      { matchTokens: [] as string[], likeConditions: [] as string[], likeParams: [] as (string | number)[] },
    );

    const ftsMatch = matchTokens.join(' AND ');

    // platform filter
    const platformInputs = platform ? (Array.isArray(platform) ? platform : [platform]) : [];
    const validDbPlatforms = platformInputs.reduce((acc, raw) => {
      const dbValue = ReversePlatformMap[raw] || (PlatformMap[raw] ? raw : null);
      if (dbValue) {
        acc.push(dbValue);
      }
      return acc;
    }, [] as string[]);

    const threadInputs = threadId ? (Array.isArray(threadId) ? threadId : [threadId]) : [];
    const validThreadIds = threadInputs.filter(Boolean);

    const dbInstance = db.get();

    // Construct combined where clause
    const whereConditions = [
      ftsMatch ? 'f.content MATCH ?' : '',
      ...likeConditions,
      validDbPlatforms.length > 0 ? `t.platform IN (${validDbPlatforms.map(() => '?').join(',')})` : '',
      validThreadIds.length > 0 ? `m.thread_id IN (${validThreadIds.map(() => '?').join(',')})` : '',
    ].filter(Boolean);

    const filteredBase = `
      FROM ${ftsMatch ? 'content_fts f CROSS JOIN content m ON f.rowid = m.id' : 'content m'}
      JOIN threads t ON m.thread_id = t.id
      ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}
    `;

    const finalParams = [...(ftsMatch ? [ftsMatch] : []), ...likeParams, ...validDbPlatforms, ...validThreadIds];

    // 1. Get total count
    const countResult = dbInstance.prepare(`SELECT count(*) as total ${filteredBase}`).get(...finalParams) as {
      total: number;
    };
    const total = countResult ? countResult.total : 0;

    // 2. Facets - platform
    const platformRows = dbInstance
      .prepare(`SELECT t.platform, count(*) as count ${filteredBase} GROUP BY t.platform`)
      .all(...finalParams) as { platform: string; count: number }[];
    const platforms = platformRows.reduce(
      (acc, r) => {
        acc[r.platform] = r.count;
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
    const selectClause = `SELECT m.*, t.platform, t.title as thread_title${
      ftsMatch ? ", snippet(content_fts, 0, '', '', '...', 25) as search_snippet" : ''
    }`;

    const dataSql = `${selectClause} ${filteredBase} ORDER BY m.timestamp_ms DESC LIMIT ? OFFSET ?`;
    const dataRows = dbInstance.prepare(dataSql).all(...finalParams, PAGE_SIZE, offset) as SearchRow[];

    // Process Senders (Me vs Others)
    const myNames = await getMyNames();
    const myNamesSet = new Set(myNames.map((n) => n.toLowerCase()));
    const meDisplayName = [...myNames].sort((a, b) => b.length - a.length)[0] || 'Me';

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
      let snippet = row.search_snippet || row.content;
      // If it looks like HTML (common for Gmail), strip tags for the snippet
      if (row.platform === 'google_mail' || snippet.includes('<')) {
        snippet = snippet
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      return {
        id: row.id,
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
        senders: sortedSenders,
      },
    });
  } catch (e) {
    console.error('Error searching:', e);
    return res.status(500).json({ error: 'Failed to search' });
  }
}
