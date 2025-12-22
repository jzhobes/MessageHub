import type { NextApiRequest, NextApiResponse } from 'next';
import db from '@/lib/server/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { messageId } = req.query;

  if (!messageId) {
    return res.status(400).json({ error: 'Missing messageId' });
  }

  const dbInstance = db.get();

  try {
    // 1. Get the target message details
    interface MsgRow {
      id: number;
      thread_id: string;
      timestamp_ms: number;
    }
    const msg = dbInstance.prepare('SELECT id, thread_id, timestamp_ms FROM messages WHERE id = ?').get(messageId) as
      | MsgRow
      | undefined;

    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // 2. Calculate Rank (1-based index in DESC order)
    // We count how many messages are "newer" (timestamp > target OR same timestamp but higher ID)
    interface CountRow {
      count: number;
    }
    const row = dbInstance
      .prepare(
        `
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE thread_id = ? 
        AND (timestamp_ms > ? OR (timestamp_ms = ? AND id > ?))
    `,
      )
      .get(msg.thread_id, msg.timestamp_ms, msg.timestamp_ms, msg.id) as CountRow;

    const newerCount = row.count;
    const rank = newerCount + 1;
    const PAGE_SIZE = 100; // Must match api/messages.ts
    const page = Math.ceil(rank / PAGE_SIZE);

    // 3. Get Platform info for context switching
    interface ThreadRow {
      platform: string;
    }
    const thread = dbInstance.prepare('SELECT platform FROM threads WHERE id = ?').get(msg.thread_id) as ThreadRow;

    return res.status(200).json({
      threadId: msg.thread_id,
      platform: thread.platform,
      page: page,
      timestamp: msg.timestamp_ms,
    });
  } catch (e) {
    console.error('Error in jump:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
