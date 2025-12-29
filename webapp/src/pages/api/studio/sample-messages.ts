import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { threadIds, limit = 100 } = req.body;

  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return res.status(400).json({ error: 'Missing threadIds' });
  }

  try {
    const myNames = await getMyNames();
    const placeholders = threadIds.map(() => '?').join(',');
    const namePlaceholders = myNames.map(() => '?').join(',');

    // Fetch a sample of messages where the user is the sender
    const rows = db
      .get()
      .prepare(
        `
      SELECT content 
      FROM content 
      WHERE thread_id IN (${placeholders})
        AND sender_name IN (${namePlaceholders})
        AND content IS NOT NULL
        AND content != ''
      LIMIT ?
    `,
      )
      .all(...threadIds, ...myNames, limit) as { content: string }[];

    return res.status(200).json({
      messages: rows.map((r) => r.content),
    });
  } catch (e) {
    console.error('Failed to fetch sample messages:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
