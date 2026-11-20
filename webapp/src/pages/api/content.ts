import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { RawContentRow, transformContentRows } from '@/lib/shared/contentTransform';
import { ContentRecord } from '@/lib/shared/types';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Fetches paginated content records (`PAGE_SIZE = 100`, newest first) for a real `threadId` or
 * virtual Facebook aggregate IDs (`fb-event-*`, `fb-post-all`, `fb-checkin-all`). Reclassifies generic
 * `file` attachments by extension and splits mixed text+media rows into separate media and text bubbles
 * unless the row looks like a single-photo link preview.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { threadId, page = '1' } = req.query;

  if (!threadId) {
    return res.status(400).json({ error: 'Missing threadId' });
  }

  const threadIdStr = Array.isArray(threadId) ? threadId[0] : threadId;
  const pageNum = parseInt(Array.isArray(page) ? page[0] : page, 10) || 1;
  const PAGE_SIZE = 100; // SQLite pagination size
  const offset = (pageNum - 1) * PAGE_SIZE;

  // Identify "Me"
  const myNames = await getMyNames();

  try {
    if (!db.exists()) {
      return res.status(200).json([]);
    }

    let rows: RawContentRow[] = [];

    if (threadIdStr.startsWith('fb-event-') || threadIdStr === 'fb-post-all' || threadIdStr === 'fb-checkin-all') {
      const catMap: Record<string, string | null> = {
        'fb-event-owned': 'Created Event',
        'fb-event-joined': 'Joined Event',
        'fb-event-interested': 'Interested in Event',
        'fb-event-declined': 'Declined Event',
        'fb-post-all': null,
        'fb-checkin-all': null,
      };

      const statusCondition = threadIdStr.startsWith('fb-event-') ? 'AND c.content = ?' : '';
      const label = threadIdStr.includes('post') ? 'post' : threadIdStr.includes('checkin') ? 'checkin' : 'event';
      const statusValue = catMap[threadIdStr];

      const queryParams: (string | number)[] = [];
      if (statusValue) {
        queryParams.push(statusValue);
      }
      queryParams.push(PAGE_SIZE, offset);

      rows = db
        .get()
        .prepare(
          `
        SELECT c.*, MAX(t.title) as event_title 
        FROM content c
        INNER JOIN threads t ON c.thread_id = t.id
        INNER JOIN thread_labels tl ON t.id = tl.thread_id
        WHERE tl.label = '${label}' ${statusCondition}
        GROUP BY c.timestamp_ms
        ORDER BY c.timestamp_ms DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(...queryParams) as RawContentRow[];
    } else {
      const isFbEvent = threadIdStr.startsWith('fb_event_');
      const groupBy = isFbEvent ? 'GROUP BY timestamp_ms' : '';

      rows = db
        .get()
        .prepare(
          `
        SELECT * FROM content 
        WHERE thread_id = ? 
        ${groupBy}
        ORDER BY timestamp_ms DESC 
        LIMIT ? OFFSET ?
    `,
        )
        .all(threadIdStr, PAGE_SIZE, offset) as RawContentRow[];
    }

    const records: ContentRecord[] = transformContentRows(rows, myNames, threadIdStr);

    return res.status(200).json({ records });
  } catch (e) {
    console.error('Error querying messages:', e);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
}
