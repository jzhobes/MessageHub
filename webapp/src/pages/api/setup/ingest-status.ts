import { ingestionManager } from '@/lib/server/ingestionManager';

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json(ingestionManager.getState());
}
