import db from '@/lib/server/db';

import type { NextApiRequest, NextApiResponse } from 'next';

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
    let rank = newerCount + 1;
    // 3. Get Platform and Category info for context switching
    interface ThreadRow {
      platform: string;
    }
    const thread = dbInstance.prepare('SELECT platform FROM threads WHERE id = ?').get(record.thread_id) as ThreadRow;

    // Get the category (label) for this thread
    interface LabelRow {
      label: string;
    }
    const labels = dbInstance
      .prepare('SELECT label FROM thread_labels WHERE thread_id = ?')
      .all(record.thread_id) as LabelRow[];

    const category = labels.find((l) => l.label === 'message')
      ? 'message'
      : labels.find((l) => l.label === 'inbox')
        ? 'inbox'
        : labels[0]?.label || 'message';

    let threadId = record.thread_id;

    // Handle Virtual Aggregated Views (Posts, Check-ins, Events)
    if (category === 'post') {
      threadId = 'fb-post-all';
      // Calculate rank in the global post timeline (Grouped by timestamp)
      const postRow = dbInstance
        .prepare(
          `
        SELECT COUNT(DISTINCT timestamp_ms) as count
        FROM content c
        INNER JOIN thread_labels tl ON c.thread_id = tl.thread_id
        WHERE tl.label = 'post' AND c.timestamp_ms > ?
      `,
        )
        .get(record.timestamp_ms) as CountRow;
      rank = postRow.count + 1;
    } else if (category === 'checkin') {
      threadId = 'fb-checkin-all';
      const checkinRow = dbInstance
        .prepare(
          `
        SELECT COUNT(DISTINCT timestamp_ms) as count
        FROM content c
        INNER JOIN thread_labels tl ON c.thread_id = tl.thread_id
        WHERE tl.label = 'checkin' AND c.timestamp_ms > ?
      `,
        )
        .get(record.timestamp_ms) as CountRow;
      rank = checkinRow.count + 1;
    } else if (category === 'event') {
      // Find which event bucket this belongs to
      interface ContentDetail {
        content: string;
      }
      const detail = dbInstance.prepare('SELECT content FROM content WHERE id = ?').get(messageId) as ContentDetail;

      const eventStatus = detail.content;
      if (eventStatus === 'Created Event') {
        threadId = 'fb-event-owned';
      } else if (eventStatus === 'Joined Event') {
        threadId = 'fb-event-joined';
      } else if (eventStatus === 'Interested in Event') {
        threadId = 'fb-event-interested';
      } else if (eventStatus === 'Declined Event') {
        threadId = 'fb-event-declined';
      }

      if (threadId.startsWith('fb-event-')) {
        const eventRow = dbInstance
          .prepare(
            `
          SELECT COUNT(DISTINCT timestamp_ms) as count
          FROM content c
          INNER JOIN thread_labels tl ON c.thread_id = tl.thread_id
          WHERE tl.label = 'event' AND c.content = ? AND c.timestamp_ms > ?
        `,
          )
          .get(eventStatus, record.timestamp_ms) as CountRow;
        rank = eventRow.count + 1;
      }
    }

    const PAGE_SIZE = 100; // Must match api/content.ts
    const page = Math.ceil(rank / PAGE_SIZE);

    return res.status(200).json({
      threadId: threadId,
      platform: thread.platform,
      page: page,
      timestamp: record.timestamp_ms,
      category: category,
    });
  } catch (e) {
    console.error('Error in jump:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
