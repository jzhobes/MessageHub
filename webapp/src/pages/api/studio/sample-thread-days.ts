import { sampleThreadDays, ThreadDaySampleResult } from '@/lib/server/dataset/sampleThreadDays';
import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';

import type { NextApiRequest, NextApiResponse } from 'next';

interface SampleThreadDaysBody {
  threadIds: string[];
  identityNames?: string[];
  dateRange?: { start: number; end: number };
  timeZone?: string;
  targetMessages?: number;
}

/**
 * Deterministically samples selected threads (`POST`) within the optional `dateRange` and returns
 * per-day message counts plus auto-selected representative days targeting ~100 messages per thread.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { threadIds, identityNames: uiNames, dateRange, timeZone, targetMessages } = req.body as SampleThreadDaysBody;

  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return res.status(400).json({ error: 'Missing threadIds' });
  }

  try {
    if (!db.exists()) {
      return res.status(200).json({ results: {} });
    }

    const dbNames = await getMyNames();
    const mergedNames = [...new Set([...(uiNames || []), ...dbNames])];
    const dbInstance = db.get();

    const results: Record<string, ThreadDaySampleResult> = {};
    for (let i = 0; i < threadIds.length; i++) {
      const threadId = threadIds[i];
      if (i > 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      results[threadId] = sampleThreadDays(dbInstance, threadId, mergedNames, {
        dateRange,
        timeZone,
        targetMessages,
      });
    }

    return res.status(200).json({ results });
  } catch (error: unknown) {
    console.error('Failed to sample thread days:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: (error as Error).message });
  }
}
