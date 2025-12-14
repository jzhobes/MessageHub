import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '../../utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { q, page = '1', platform, threadId } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing search query' });
  }

  const queryStr = q;
  const pageNum = parseInt(Array.isArray(page) ? page[0] : page, 10) || 1;
  const PAGE_SIZE = 100;
  const offset = (pageNum - 1) * PAGE_SIZE;

  const db = getDb();

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

    let sql = `
        SELECT m.*, t.platform, t.title as thread_title
        FROM messages m
        JOIN threads t ON m.thread_id = t.id
        WHERE m.content LIKE ?
    `;

    const params: (string | number)[] = [`%${queryStr}%`];

    if (platform) {
      sql += ' AND t.platform = ?';
      // Map frontend platform name to DB value: lowercase, space to underscore
      const pStr = (Array.isArray(platform) ? platform[0] : platform).toLowerCase().replace(' ', '_');
      params.push(pStr);
    }

    if (threadId) {
      sql += ' AND m.thread_id = ?';
      params.push(Array.isArray(threadId) ? threadId[0] : threadId);
    }

    sql += ' ORDER BY m.timestamp_ms DESC LIMIT ? OFFSET ?';
    params.push(PAGE_SIZE, offset);

    const rows = db.prepare(sql).all(...params) as SearchRow[];

    const results = rows.map((row) => ({
      message_id: row.id,
      thread_id: row.thread_id,
      thread_title: row.thread_title,
      platform: row.platform,
      sender_name: row.sender_name,
      timestamp: row.timestamp_ms,
      content: row.content,
      snippet: row.content, // Full content as snippet for now
    }));

    return res.status(200).json(results);
  } catch (e) {
    console.error('Error searching:', e);
    return res.status(500).json({ error: 'Failed to search' });
  }
}
