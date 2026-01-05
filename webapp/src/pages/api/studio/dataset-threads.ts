import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { inferThreadTitle } from '@/lib/server/threadUtils';

import type { NextApiRequest, NextApiResponse } from 'next';

interface ThreadStatsRow {
  id: string;
  title: string;
  platform: string;
  timestamp: number;
  is_group: number;
  total_msgs: number;
  my_msgs: number;
  my_avg_len: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform } = req.query;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  if (!db.exists()) {
    return res.status(200).json([]);
  }

  const myNames = await getMyNames();

  const namesPlaceholders = myNames.map(() => '?').join(',');

  // 1. Get raw stats per thread
  let query = `
    SELECT 
      t.id, 
      t.title,
      t.platform,
      t.last_activity_ms as timestamp,
      t.is_group,
      t.participants_json,
      COUNT(m.id) as total_msgs,
      SUM(CASE WHEN m.sender_name IN (${namesPlaceholders}) AND m.content NOT LIKE 'http%' AND m.content NOT LIKE 'https%' THEN 1 ELSE 0 END) as my_msgs,
      AVG(CASE WHEN m.sender_name IN (${namesPlaceholders}) AND m.content NOT LIKE 'http%' AND m.content NOT LIKE 'https%' THEN LENGTH(m.content) ELSE NULL END) as my_avg_len
    FROM threads t
    JOIN content m ON m.thread_id = t.id
  `;

  const params: (string | number)[] = [...myNames, ...myNames]; // User names are used twice in the CASE statements

  const conditions = [
    "EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = t.id AND tl.label IN ('message', 'inbox', 'sent'))",
  ];
  if (platformStr && platformStr !== 'all') {
    conditions.push('t.platform = ?');
    params.push(platformStr);
  }

  query += ' WHERE ' + conditions.join(' AND ');

  query += ' GROUP BY t.id';
  query += ' ORDER BY t.last_activity_ms DESC';

  try {
    interface ExtendedThreadRow extends ThreadStatsRow {
      participants_json: string;
    }

    const dbInstance = db.get();
    const rows = dbInstance.prepare(query).all(...params) as unknown as ExtendedThreadRow[];

    // 2. Calculate "Clone Score"
    const threadsWithScore = rows.map((row) => {
      const myCount = row.my_msgs ?? 0;
      const total = row.total_msgs ?? 1;
      const avgLen = row.my_avg_len ?? 0;

      // Title Generation Logic
      const participants = JSON.parse(row.participants_json || '[]');
      const title = inferThreadTitle(row.title, participants, myNames);

      const ratio = myCount / total; // 0.0 to 1.0

      // Heuristic Scoring (0 - 100)
      const age = Date.now() - row.timestamp;
      const TWO_YEARS = 63113904000; // 2 years in ms
      const recencyScore = Math.max(0, 20 * (1 - age / TWO_YEARS));
      const participationScore = Math.min(ratio * 30, 30);
      const logLen = Math.log(avgLen ?? 1);
      const substanceScore = Math.min(Math.max(0, logLen * 6), 25);
      const volumeScore = Math.min(Math.sqrt(myCount) * 3, 25);

      let finalScore = recencyScore + participationScore + substanceScore + volumeScore;
      if (myCount < 5) {
        finalScore = 0;
      }

      return {
        id: row.id,
        title: title || 'Untitled',
        platform: row.platform,
        timestamp: row.timestamp,
        is_group: !!row.is_group,
        pageCount: 1,
        type: 'message',
        messageCount: total,
        myMessageCount: myCount,
        participationRatio: ratio,
        myAvgMessageLength: Math.round(avgLen),
        qualityScore: Math.round(finalScore),
      };
    });

    // 3. Add Virtual Threads (Posts, Check-ins, Events) if applicable
    if (!platformStr || platformStr === 'all' || platformStr === 'facebook') {
      // Posts
      const postStats = dbInstance
        .prepare(
          `
        SELECT COUNT(*) as count, MAX(t.last_activity_ms) as last_ts, AVG(LENGTH(m.content)) as avg_len
        FROM threads t
        JOIN thread_labels tl ON t.id = tl.thread_id
        JOIN content m ON m.thread_id = t.id
        WHERE t.platform = 'facebook' AND tl.label = 'post'
          AND m.content NOT LIKE 'http%' AND m.content NOT LIKE 'https%'
      `,
        )
        .get() as { count: number; last_ts: number | null; avg_len: number | null };

      if (postStats.count > 0) {
        const score = Math.min(
          Math.max(0, 20 * (1 - (Date.now() - (postStats.last_ts || 0)) / 63113904000)) + // recency
            30 + // participation (100% manual usually)
            Math.min(Math.log(postStats.avg_len || 1) * 6, 25) + // substance
            Math.min(Math.sqrt(postStats.count) * 3, 25), // volume
          100,
        );
        threadsWithScore.push({
          id: 'fb-post-all',
          title: 'My Posts',
          platform: 'facebook',
          timestamp: postStats.last_ts || 0,
          is_group: false,
          pageCount: 1,
          type: 'post',
          messageCount: postStats.count,
          myMessageCount: postStats.count,
          participationRatio: 1,
          myAvgMessageLength: Math.round(postStats.avg_len || 0),
          qualityScore: Math.round(score),
        });
      }

      // Events - Simplified aggregation for Studio
      const eventCats = [
        { id: 'fb-event-owned', title: 'Your Events', status: ['Created Event'] },
        { id: 'fb-event-joined', title: 'Joined Events', status: ['Joined Event', 'Interested in Event'] },
      ];

      for (const cat of eventCats) {
        const placeholders = cat.status.map(() => '?').join(',');
        const estats = dbInstance
          .prepare(
            `
          SELECT COUNT(*) as count, MAX(c.timestamp_ms) as last_ts
          FROM content c
          INNER JOIN thread_labels tl ON c.thread_id = tl.thread_id
          WHERE tl.label = 'event' AND c.content IN (${placeholders})
        `,
          )
          .get(...cat.status) as { count: number; last_ts: number | null };

        if (estats.count > 0) {
          let score = Math.min(
            Math.max(0, 20 * (1 - (Date.now() - (estats.last_ts || 0)) / 63113904000)) + // recency
              Math.min(Math.sqrt(estats.count) * 5, 40), // volume
            60,
          );

          if (cat.id === 'fb-event-owned') {
            score += 20;
          }

          threadsWithScore.push({
            id: cat.id,
            title: cat.title,
            platform: 'facebook',
            timestamp: estats.last_ts || 0,
            is_group: false,
            pageCount: 1,
            type: 'event',
            messageCount: estats.count,
            myMessageCount: estats.count,
            participationRatio: 1,
            myAvgMessageLength: 0,
            qualityScore: Math.round(score),
          });
        }
      }
    }

    // Sort by Quality Score (highest first)
    threadsWithScore.sort((a, b) => b.qualityScore - a.qualityScore);

    res.status(200).json(threadsWithScore);
  } catch (e) {
    console.error('Failed to analyze threads:', e);
    res.status(500).json({ error: 'Analysis failed' });
  }
}
