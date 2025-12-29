import { getMyNames } from '@/lib/server/identity';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const names = await getMyNames();
    res.status(200).json({ names });
  } catch (e) {
    console.error('Failed to get identity:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
