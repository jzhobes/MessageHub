import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { containsHtmlOrEntities, decodeHtmlEntities, stripHtml, stripUrls } from '@/lib/shared/stringUtils';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Missing ids' });
  }

  try {
    const myNames = await getMyNames();
    const dbInstance = db.get();

    // Initialize all requested IDs with empty arrays
    const result = ids.reduce(
      (acc, id) => {
        acc[id] = [];
        return acc;
      },
      {} as Record<string, string[]>,
    );

    // Group IDs by type
    const realThreadIds = ids.filter((id: string) => !id.startsWith('fb-post-') && !id.startsWith('fb-event-'));
    const virtualPostIds = ids.filter((id: string) => id === 'fb-post-all');
    const virtualEventIds = ids.filter((id: string) => id.startsWith('fb-event-'));

    // 1. Fetch from real threads
    if (realThreadIds.length > 0 && myNames.length > 0) {
      const placeholders = realThreadIds.map(() => '?').join(',');
      const namePlaceholders = myNames.map(() => '?').join(',');
      const rows = dbInstance
        .prepare(
          `
        SELECT thread_id, content 
        FROM content 
        WHERE thread_id IN (${placeholders})
          AND sender_name IN (${namePlaceholders})
          AND content IS NOT NULL 
          AND content != ''
          AND content NOT LIKE '%sent an attachment.'
          AND content NOT LIKE 'http%'
          AND content NOT LIKE 'www.%'
        ORDER BY timestamp_ms DESC
      `,
        )
        .all(...realThreadIds, ...myNames) as { thread_id: string; content: string }[];

      rows.forEach((row) => {
        if (result[row.thread_id].length < 15) {
          const clean = cleanThreadMessage(row.content);
          if (clean) {
            result[row.thread_id].push(clean);
          }
        }
      });
    }

    // 2. Fetch from Virtual Posts
    if (virtualPostIds.length > 0) {
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
        LIMIT 100
      `,
        )
        .all() as { content: string }[];

      rows.forEach((row) => {
        if (result['fb-post-all'].length < 20) {
          const clean = cleanThreadMessage(row.content);
          if (clean) {
            result['fb-post-all'].push(`Social post: ${clean}`);
          }
        }
      });
    }

    // 3. Fetch from Virtual Events
    if (virtualEventIds.length > 0) {
      const rows = dbInstance
        .prepare(
          `
        SELECT t.title as content
        FROM content m
        JOIN threads t ON m.thread_id = t.id
        JOIN thread_labels tl ON m.thread_id = tl.thread_id
        WHERE tl.label = 'event'
        ORDER BY m.timestamp_ms DESC
        LIMIT 100
      `,
        )
        .all() as { content: string }[];

      virtualEventIds.forEach((id) => {
        const prefix = id === 'fb-event-owned' ? 'I am hosting an event:' : 'I am joining an event:';
        rows.forEach((row) => {
          if (result[id].length < 20) {
            const clean = cleanThreadMessage(row.content);
            if (clean) {
              result[id].push(`${prefix} ${clean}`);
            }
          }
        });
      });
    }

    return res.status(200).json(result);
  } catch (e) {
    console.error('Failed to fetch thread content:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function cleanThreadMessage(content: string): string | null {
  let clean = content;
  if (containsHtmlOrEntities(clean)) {
    clean = decodeHtmlEntities(stripHtml(clean));
  }
  clean = stripUrls(clean);
  return clean || null;
}
