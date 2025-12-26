import type { NextApiRequest, NextApiResponse } from 'next';
import db from '@/lib/server/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { messageId } = req.query;

  if (!messageId) {
    return res.status(400).json({ error: 'Missing messageId' });
  }

  const dbInstance = db.get();

  try {
    // 1. Get the target content record details
    interface ContentRow {
      id: number;
      thread_id: string;
      timestamp_ms: number;
    }
    const record = dbInstance.prepare('SELECT id, thread_id, timestamp_ms FROM content WHERE id = ?').get(messageId) as
      | ContentRow
      | undefined;

    if (!record) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // 2. Calculate Rank (1-based index in DESC order)
    // We count how many records are "newer" (timestamp > target OR same timestamp but higher ID)
    interface CountRow {
      count: number;
    }
    const row = dbInstance
      .prepare(
        `
        SELECT COUNT(*) as count 
        FROM content 
        WHERE thread_id = ? 
        AND (timestamp_ms > ? OR (timestamp_ms = ? AND id > ?))
    `,
      )
      .get(record.thread_id, record.timestamp_ms, record.timestamp_ms, record.id) as CountRow;

    const newerCount = row.count;
    const rank = newerCount + 1;
    const PAGE_SIZE = 100; // Must match api/content.ts
    const page = Math.ceil(rank / PAGE_SIZE);

    // 3. Get Platform info for context switching
    interface ThreadRow {
      platform: string;
    }
    const thread = dbInstance.prepare('SELECT platform FROM threads WHERE id = ?').get(record.thread_id) as ThreadRow;

    return res.status(200).json({
      threadId: record.thread_id,
      platform: thread.platform,
      page: page,
      timestamp: record.timestamp_ms,
    });
  } catch (e) {
    console.error('Error in jump:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
