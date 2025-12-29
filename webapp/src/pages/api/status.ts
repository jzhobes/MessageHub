import db from '@/lib/server/db';
import { PlatformMap } from '@/lib/shared/platforms';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!db.exists()) {
      const empty: Record<string, boolean> = {};
      Object.keys(PlatformMap).forEach((dbKey) => (empty[dbKey] = false));
      return res.status(200).json({ initialized: false, platforms: empty });
    }

    const _db = db.get();

    const hasThreads = (platform: string) => {
      const result = _db.prepare('SELECT count(*) as count FROM threads WHERE platform = ?').get(platform) as {
        count: number;
      };
      return result?.count > 0;
    };

    const status: Record<string, boolean> = {};
    Object.keys(PlatformMap).forEach((dbKey) => {
      status[dbKey] = hasThreads(dbKey);
    });

    res.status(200).json({
      initialized: true,
      platforms: status,
    });
  } catch {
    res.status(500).json({ status: 'error', message: 'Database query failed' });
  }
}
