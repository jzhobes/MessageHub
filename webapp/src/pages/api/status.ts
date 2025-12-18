import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb, dbExists } from '@/lib/server/db';

import { PlatformMap } from '@/lib/shared/platforms';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!dbExists()) {
      const empty: Record<string, boolean> = {};
      Object.values(PlatformMap).forEach((label) => (empty[label] = false));
      return res.status(200).json({ initialized: false, platforms: empty });
    }

    const db = getDb();

    const hasThreads = (platform: string) => {
      const result = db.prepare('SELECT count(*) as count FROM threads WHERE platform = ?').get(platform) as { count: number };
      return result?.count > 0;
    };

    const status: Record<string, boolean> = {};
    Object.entries(PlatformMap).forEach(([dbKey, label]) => {
      status[label] = hasThreads(dbKey);
    });

    res.status(200).json({
      initialized: true,
      platforms: status,
    });
  } catch {
    res.status(500).json({ status: 'error', message: 'Database query failed' });
  }
}
