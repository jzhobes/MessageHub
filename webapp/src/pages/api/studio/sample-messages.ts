import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { containsHtmlOrEntities, decodeHtmlEntities, stripHtml, stripUrls } from '@/lib/shared/stringUtils';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { threadIds, limit = 100 } = req.body;

  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return res.status(400).json({ error: 'Missing threadIds' });
  }

  try {
    const myNames = await getMyNames();
    const dbInstance = db.get();

    // Separate real IDs from virtual IDs
    const realThreadIds = threadIds.filter((id: string) => !id.startsWith('fb-post-') && !id.startsWith('fb-event-'));
    const hasPosts = threadIds.includes('fb-post-all');
    const hasEvents = threadIds.some((id: string) => id.startsWith('fb-event-'));

    const results: { content: string }[] = [];

    // 1. Fetch from real threads
    if (realThreadIds.length > 0) {
      const placeholders = realThreadIds.map(() => '?').join(',');
      const namePlaceholders = myNames.map(() => '?').join(',');
      const rows = dbInstance
        .prepare(
          `
        SELECT content 
        FROM content 
        WHERE thread_id IN (${placeholders})
          AND sender_name IN (${namePlaceholders})
          AND content IS NOT NULL
          AND content != ''
          AND content NOT LIKE '%sent an attachment.'
          AND content NOT LIKE 'http%'
          AND content NOT LIKE 'www.%'
        ORDER BY timestamp_ms DESC
        LIMIT ?
      `,
        )
        .all(...realThreadIds, ...myNames, limit) as { content: string }[];
      results.push(...rows);
    }

    // 2. Fetch from Virtual Posts
    if (hasPosts && results.length < limit) {
      const rows = dbInstance
        .prepare(
          `
        SELECT m.content 
        FROM content m
        JOIN thread_labels tl ON m.thread_id = tl.thread_id
        WHERE tl.label = 'post'
          AND m.content IS NOT NULL
          AND m.content != ''
          AND m.content NOT LIKE 'http%'
        ORDER BY m.timestamp_ms DESC
        LIMIT ?
      `,
        )
        .all(limit - results.length) as { content: string }[];
      results.push(...rows);
    }

    // 3. Fetch from Virtual Events
    if (hasEvents && results.length < limit) {
      const rows = dbInstance
        .prepare(
          `
        SELECT t.title as content
        FROM content m
        JOIN threads t ON m.thread_id = t.id
        JOIN thread_labels tl ON m.thread_id = tl.thread_id
        WHERE tl.label = 'event'
        ORDER BY m.timestamp_ms DESC
        LIMIT ?
      `,
        )
        .all(limit - results.length) as { content: string }[];
      results.push(...rows);
    }

    return res.status(200).json({
      messages: results.map((r) => {
        const content = r.content;
        if (containsHtmlOrEntities(content)) {
          return stripUrls(decodeHtmlEntities(stripHtml(content)));
        }
        return stripUrls(content);
      }),
    });
  } catch (e) {
    console.error('Failed to fetch sample messages:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
