import type { NextApiRequest, NextApiResponse } from 'next';
import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';

/**
 * API Handler to list message threads for a specific platform.
 * Reads from the SQLite database.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform } = req.query;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  if (!db.exists()) {
    return res.status(200).json([]);
  }

  // Retrieve 'My Names' for title filtering
  const myNames = await getMyNames();

  // Use correlated subquery to get message count efficiently
  let query = `
    SELECT t.*, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) as msg_count 
    FROM threads t
  `;
  const params: string[] = [];

  if (platformStr) {
    query += ' WHERE platform = ?';
    // Normalize: "Google Chat" -> "google_chat", "Facebook" -> "facebook"
    params.push(platformStr.toLowerCase().replace(' ', '_'));
  }

  query += ' ORDER BY last_activity_ms DESC';

  try {
    interface ThreadRow {
      id: string;
      platform: string;
      title: string | null;
      participants_json: string;
      is_group: number;
      last_activity_ms: number;
      snippet: string | null;
      msg_count: number;
    }

    const dbInstance = db.get();
    const rows = dbInstance.prepare(query).all(...params) as ThreadRow[];
    const PAGE_SIZE = 100;

    const threads = rows.map((row) => {
      const participants = JSON.parse(row.participants_json || '[]');
      let title = row.title;

      // Fallback title generation with filtering
      if (!title || title.trim() === '') {
        const others = participants.filter((p: string) => !myNames.includes(p));
        if (others.length === 0) {
          // Talking to self or only me in list
          title = `${myNames[0] || 'Me'} (You)`;
        } else {
          title = others.join(', ');
        }
      }

      return {
        id: row.id,
        title: title || 'Untitled',
        participants,
        timestamp: row.last_activity_ms ?? 0,
        snippet: row.snippet ?? '',
        pageCount: Math.ceil((row.msg_count ?? 0) / PAGE_SIZE),
      };
    });

    return res.status(200).json(threads);
  } catch (e) {
    console.error('Error querying threads:', e);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
}
