import type { NextApiRequest, NextApiResponse } from 'next';
import db from '@/lib/server/db';
import { PlatformMap, ReversePlatformMap } from '@/lib/shared/platforms';
import { getMyNames } from '@/lib/server/identity';

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
    }

    let baseSql = `
        FROM messages m
        JOIN threads t ON m.thread_id = t.id
    `;

    // Tokenize query
    const tokens = parseSearchQuery(queryStr);

    const whereConditions: string[] = [];
    const params: (string | number)[] = [];

    // Build LIKE conditions for each token (Implicit AND)
    tokens.forEach((token) => {
      let isStartOfWord = false;
      let actualToken = token;

      if (actualToken.startsWith('^')) {
        isStartOfWord = true;
        actualToken = actualToken.slice(1);
      }

      // 1. Sanitize: Escape existing SQL wildcards/escape chars in the token
      let sanitized = actualToken.replace(/[%_\\]/g, '\\$&');

      // 2. Transform: Convert Glob wildcards to SQL wildcards
      sanitized = sanitized.replace(/\*/g, '%').replace(/\?/g, '_');

      if (isStartOfWord) {
        // Check for: Start of string OR Space before OR Newline before
        // We group these with OR, and push to whereConditions
        // Since we need to parameterize multiple values, we can't just push one param.
        // But the query structure assumes sequential params.
        // We'll push the SQL string and push 3 params.
        whereConditions.push(`(m.content LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')`);
        params.push(`${sanitized}%`); // Start of msg
        params.push(`% ${sanitized}%`); // After space
        params.push(`%\n${sanitized}%`); // After newline
      } else {
        whereConditions.push("m.content LIKE ? ESCAPE '\\'");
        params.push(`%${sanitized}%`);
      }
    });

    baseSql += ' WHERE ' + whereConditions.join(' AND ');

    if (platform) {
      const inputs = Array.isArray(platform) ? platform : [platform];
      const validDbValues: string[] = [];

      for (const raw of inputs) {
        const dbValue = ReversePlatformMap[raw] || (PlatformMap[raw] ? raw : null);
        if (dbValue) {
          validDbValues.push(dbValue);
        }
      }

      if (validDbValues.length === 0) {
        return res.status(400).json({ error: `No valid platforms provided: ${inputs.join(', ')}` });
      }

      // Create placeholders for IN clause: ?,?,?
      const placeholders = validDbValues.map(() => '?').join(',');
      baseSql += ` AND t.platform IN (${placeholders})`;
      params.push(...validDbValues);
    }

    if (threadId) {
      baseSql += ' AND m.thread_id = ?';
      params.push(Array.isArray(threadId) ? threadId[0] : threadId);
    }

    const dbInstance = db.get();

    // Get total count
    const countSql = `SELECT count(*) as total ${baseSql}`;
    const countResult = dbInstance.prepare(countSql).get(...params) as { total: number };
    const total = countResult ? countResult.total : 0;

    // Facets - platform breakdown
    const platformSql = `SELECT t.platform, count(*) as count ${baseSql} GROUP BY t.platform`;
    const platformRows = dbInstance.prepare(platformSql).all(...params) as { platform: string; count: number }[];
    const platforms: Record<string, number> = {};
    platformRows.forEach((r) => {
      platforms[r.platform] = r.count;
    });

    // Facets - sender breakdown (top 20)
    const senderSql = `SELECT m.sender_name, count(*) as count ${baseSql} GROUP BY m.sender_name ORDER BY count DESC LIMIT 20`;
    const senderRows = dbInstance.prepare(senderSql).all(...params) as { sender_name: string; count: number }[];

    // Normalize personal names
    const myNames = await getMyNames();
    const myNamesSet = new Set(myNames.map((n) => n.toLowerCase()));

    // Pick the longest name as display name (e.g. "John Doe" > "Me")
    const meDisplayName = [...myNames].sort((a, b) => b.length - a.length)[0];

    const senders: Record<string, number> = {};
    let meCount = 0;

    senderRows.forEach((r) => {
      const name = r.sender_name || 'Unknown';
      if (myNamesSet.has(name.toLowerCase())) {
        meCount += r.count;
      } else {
        // Accumulate normally
        senders[name] = (senders[name] || 0) + r.count;
      }
    });

    if (meCount > 0) {
      senders[meDisplayName] = meCount;
    }

    // Re-sort senders by count (descending) as consolidation may have disrupted the SQL order
    const sortedSenders = Object.fromEntries(Object.entries(senders).sort((a, b) => b[1] - a[1]));

    // Get data
    const dataSql = `SELECT m.*, t.platform, t.title as thread_title ${baseSql} ORDER BY m.timestamp_ms DESC LIMIT ? OFFSET ?`;
    const dataRows = dbInstance.prepare(dataSql).all(...params, PAGE_SIZE, offset) as SearchRow[];

    const results = dataRows.map((row) => ({
      message_id: row.id,
      thread_id: row.thread_id,
      thread_title: row.thread_title,
      platform: row.platform,
      sender_name: row.sender_name,
      timestamp: row.timestamp_ms,
      content: row.content,
      snippet: row.content,
    }));

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

function parseSearchQuery(queryStr: string): string[] {
  const tokens: string[] = [];
  const quoteRegex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = quoteRegex.exec(queryStr)) !== null) {
    if (match[1]) {
      // Quoted phrase: strict match of the phrase
      tokens.push(match[1]);
    } else {
      // Regular word
      tokens.push(match[2]);
    }
  }

  if (tokens.length === 0) {
    tokens.push(queryStr);
  }
  return tokens;
}
