import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '../../utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const db = getDb();

    const count = (platform: string) => {
      const result = db.prepare('SELECT count(*) as count FROM threads WHERE platform = ?').get(platform) as { count: number };
      return result?.count > 0;
    };

    const status = {
      Facebook: count('facebook'),
      Instagram: count('instagram'),
      'Google Chat': count('google_chat'),
      'Google Voice': false,
    };

    res.status(200).json(status);
  } catch {
    res.status(500).json({ status: 'error', message: 'Database query failed' });
  }
}
