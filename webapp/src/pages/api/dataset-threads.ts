import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { getPlatformLabel } from '@/lib/shared/platforms';

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

  const db = getDb();
  const myNames = await getMyNames();

  // Create absolute SQL placeholders like '?, ?, ?' for the "IN" clause
  const namesPlaceholders = myNames.map(() => '?').join(',');

  // 1. Get raw stats per thread
  // We utilize a subquery or join. Grouping by thread_id on the messages table is efficient if indexed.
  // Note: LENGTH(content) is a rough proxy for token count.
  let query = `
    SELECT 
      t.id, 
      t.title,
      t.platform,
      t.last_activity_ms as timestamp,
      t.is_group,
      t.participants_json,
      COUNT(m.id) as total_msgs,
      SUM(CASE WHEN m.sender_name IN (${namesPlaceholders}) THEN 1 ELSE 0 END) as my_msgs,
      AVG(CASE WHEN m.sender_name IN (${namesPlaceholders}) THEN LENGTH(m.content) ELSE NULL END) as my_avg_len
    FROM threads t
    JOIN messages m ON m.thread_id = t.id
  `;

  const params: (string | number)[] = [...myNames, ...myNames]; // User names are used twice in the CASE statements

  if (platformStr && platformStr !== 'all') {
    query += ' WHERE t.platform = ?';
    params.push(platformStr);
  }

  query += ' GROUP BY t.id';
  query += ' ORDER BY t.last_activity_ms DESC';

  try {
    interface ExtendedThreadRow extends ThreadStatsRow {
      participants_json: string;
    }

    const rows = db.prepare(query).all(...params) as unknown as ExtendedThreadRow[];

    // 2. Calculate "Clone Score"
    const threadsWithScore = rows.map((row) => {
      const myCount = row.my_msgs || 0;
      const total = row.total_msgs || 1;
      const avgLen = row.my_avg_len || 0;

      // Title Generation Logic
      let title = row.title;
      if (!title || title.trim() === '') {
        const participants = JSON.parse(row.participants_json || '[]');
        const others = participants.filter((p: string) => !myNames.includes(p));
        if (others.length === 0) {
          title = `${myNames[0] || 'Me'} (You)`;
        } else {
          title = others.join(', ');
        }
      }

      const ratio = myCount / total; // 0.0 to 1.0

      // Heuristic Scoring (0 - 100)

      // 1. Recency Score (0-20 pts)
      // Favors newer content as it likely reflects current personality.
      // Linear decay over 2 years (approx 6.3e10 ms).
      const age = Date.now() - row.timestamp;
      const TWO_YEARS = 63113904000; // 2 years in ms
      const recencyScore = Math.max(0, 20 * (1 - age / TWO_YEARS));

      // 2. Participation Score (0-30 pts)
      // Ideal is balanced (~50%).
      // 5% ratio -> 3 pts
      // 25% ratio -> 15 pts
      // 50% ratio -> 30 pts (Max)
      const participationScore = Math.min(ratio * 60, 30);

      // 3. Substance Score (0-25 pts)
      // Logarithmic scale. We want to reward getting past "ok/lol" (5 chars)
      // but diminishing returns for essays.
      // log(10 chars) ~= 2.3
      // log(50 chars) ~= 3.9
      // Formula: log(len) * 6
      const logLen = Math.log(avgLen || 1);
      const substanceScore = Math.min(Math.max(0, logLen * 6), 25);

      // 4. Volume Score (0-25 pts)
      // Sqrt scale.
      // 25 msgs -> 5 * 3 = 15 pts
      // 70 msgs -> 8.3 * 3 = 25 pts (Max)
      const volumeScore = Math.min(Math.sqrt(myCount) * 3, 25);

      let finalScore = recencyScore + participationScore + substanceScore + volumeScore;

      // Hard penalties
      if (myCount < 5) {
        finalScore = 0;
      } // Not enough sample size to be useful

      return {
        id: row.id,
        title: title || 'Untitled',
        platform: getPlatformLabel(row.platform),
        timestamp: row.timestamp,
        is_group: !!row.is_group,
        file_count: 1, // Legacy prop

        // Stats
        messageCount: total,
        myMessageCount: myCount,
        participationRatio: ratio,
        myAvgMessageLength: Math.round(avgLen),
        qualityScore: Math.round(finalScore),
      };
    });

    // Sort by Score by default for this view? Or let frontend handle it.
    // Let's sort by Score DESC to surface gold first.
    threadsWithScore.sort((a, b) => b.qualityScore - a.qualityScore);

    res.status(200).json(threadsWithScore);
  } catch (e) {
    console.error('Failed to analyze threads:', e);
    res.status(500).json({ error: 'Analysis failed' });
  }
}
