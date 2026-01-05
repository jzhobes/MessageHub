import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { inferThreadTitle } from '@/lib/server/threadUtils';
import { getPlatformDbValue } from '@/lib/shared/platforms';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * API Handler to list message threads for a specific platform.
 * Reads from the SQLite database.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform, type } = req.query;

  if (!db.exists()) {
    return res.status(200).json([]);
  }

  const platformInputs = platform ? (Array.isArray(platform) ? platform : [platform]) : [];
  const validDbPlatforms = platformInputs.map(getPlatformDbValue).filter(Boolean);

  // Retrieve 'My Names' for title filtering
  const myNames = await getMyNames();

  // Use correlated subquery to get content record count efficiently
  let query = `
    SELECT t.*, (SELECT COUNT(*) FROM content c WHERE c.thread_id = t.id) as msg_count 
    FROM threads t
  `;
  const params: string[] = [];
  const conditions: string[] = [];

  if (validDbPlatforms.length > 0) {
    conditions.push(`t.platform IN (${validDbPlatforms.map(() => '?').join(',')})`);
    params.push(...validDbPlatforms);
  }

  if (type && typeof type === 'string' && type !== 'all') {
    conditions.push(`t.id IN (SELECT thread_id FROM thread_labels WHERE label = ?)`);
    params.push(type);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY t.last_activity_ms DESC';

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

    // 2. Get category counts for the current platform filter using labels
    const counts: Record<string, number> = {
      message: 0,
      event: 0,
      post: 0,
      checkin: 0,
      inbox: 0,
      sent: 0,
    };

    if (validDbPlatforms.length > 0) {
      const countQuery = `
        SELECT tl.label, COUNT(*) as count 
        FROM thread_labels tl
        INNER JOIN threads t ON tl.thread_id = t.id
        WHERE t.platform IN (${validDbPlatforms.map(() => '?').join(',')})
        GROUP BY tl.label
      `;
      const countRows = dbInstance.prepare(countQuery).all(...validDbPlatforms) as {
        label: string;
        count: number;
      }[];
      countRows.forEach((r) => {
        counts[r.label] = r.count;
      });
    }

    const threads = rows.map((row) => {
      const participants = JSON.parse(row.participants_json || '[]');
      const title = inferThreadTitle(row.title, participants, myNames);

      return {
        id: row.id,
        platform: row.platform,
        title: title || 'Untitled',
        participants,
        timestamp: row.last_activity_ms ?? 0,
        snippet: row.snippet ?? '',
        pageCount: Math.ceil((row.msg_count ?? 0) / PAGE_SIZE),
      };
    });

    if (validDbPlatforms.includes('facebook') && type === 'event') {
      const eventCats = [
        { id: 'fb-event-owned', title: 'Your Events', status: 'Created Event' },
        { id: 'fb-event-joined', title: 'Joined Events', status: 'Joined Event' },
        { id: 'fb-event-interested', title: 'Events Interested In', status: 'Interested in Event' },
        { id: 'fb-event-declined', title: 'Declined Events', status: 'Declined Event' },
      ];

      const virtualThreads = eventCats.map((cat) => {
        const stats = dbInstance
          .prepare(
            `
          SELECT COUNT(*) as count, MAX(c.timestamp_ms) as last_ts
          FROM content c
          INNER JOIN thread_labels tl ON c.thread_id = tl.thread_id
          WHERE tl.label = 'event' AND c.content = ?
        `,
          )
          .get(cat.status) as { count: number; last_ts: number | null };

        let snippet = 'No events';
        if (stats.last_ts) {
          const latestEvent = dbInstance
            .prepare(
              `
            SELECT t.title 
            FROM content c
            INNER JOIN threads t ON c.thread_id = t.id
            WHERE c.content = ? AND c.timestamp_ms = ?
            LIMIT 1
          `,
            )
            .get(cat.status, stats.last_ts) as { title: string };
          snippet = `Latest: ${latestEvent?.title || 'Unknown Event'}`;
        }

        return {
          id: cat.id,
          platform: 'facebook',
          title: cat.title,
          timestamp: stats.last_ts ?? 0,
          snippet: snippet,
          pageCount: Math.ceil((stats.count ?? 0) / PAGE_SIZE),
        };
      });

      return res.status(200).json({ threads: virtualThreads, counts });
    }

    if (validDbPlatforms.includes('facebook') && (type === 'post' || type === 'checkin')) {
      const label = type;
      const stats = dbInstance
        .prepare(
          `
        SELECT COUNT(*) as count, MAX(t.last_activity_ms) as last_ts
        FROM threads t
        INNER JOIN thread_labels tl ON t.id = tl.thread_id
        WHERE t.platform = 'facebook' AND tl.label = ?
      `,
        )
        .get(label) as { count: number; last_ts: number | null };

      const title = type === 'post' ? 'My Posts' : 'My Check-ins';
      const snippet = `Browse all ${stats.count?.toLocaleString()} ${type === 'post' ? 'posts' : 'check-ins'}`;

      const virtualThreads = [
        {
          id: `fb-${type}-all`,
          platform: 'facebook',
          title: title,
          timestamp: stats.last_ts ?? 0,
          snippet: snippet,
          pageCount: Math.ceil((stats.count ?? 0) / PAGE_SIZE),
        },
      ];
      return res.status(200).json({ threads: virtualThreads, counts });
    }

    return res.status(200).json({ threads, counts });
  } catch (e) {
    console.error('Error querying threads:', e);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
}
