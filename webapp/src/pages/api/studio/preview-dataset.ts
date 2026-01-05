import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';
import { DatasetEntry } from '@/lib/shared/types';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    threadIds,
    identityNames,
    includeGroupSpeakerNames,
    mergeSequential,
    removeSystemMessages,
    imputeReactions,
    redactPII,
    personaTag,
    customInstructions,
    skipSystemMessages,
    dateRange,
  } = req.body;

  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return res.status(400).json({ error: 'Missing threadIds' });
  }

  if (!identityNames || !Array.isArray(identityNames) || identityNames.length === 0) {
    return res.status(400).json({ error: 'Missing identityNames' });
  }

  try {
    const generator = new DatasetGenerator({
      includeGroupSpeakerNames: !!includeGroupSpeakerNames,
      mergeSequential: !!mergeSequential,
      removeSystemMessages: !!removeSystemMessages,
      imputeReactions: !!imputeReactions,
      redactPII: !!redactPII,
      personaTag: personaTag || undefined,
      customInstructions: customInstructions || undefined,
      skipSystemMessages: !!skipSystemMessages,
      maxTokensPerSession: Infinity,
      maxTokensPerFile: 100000, // Small limit for preview
    });

    generator.setDb(db.get());

    // We only take a few threads for the preview
    const previewThreadIds = (threadIds as string[]).slice(0, 3);
    const generatorStream = generator.generateStream(previewThreadIds, identityNames, dateRange);

    const allSessions: DatasetEntry[] = [];

    for await (const part of generatorStream) {
      // The stream yields file parts, we want to parse the sessions back out
      const lines = part.content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          allSessions.push(JSON.parse(line));
        }
      }
      // Don't over-collect if we have a massive thread, 20 is enough to get a recent sample
      if (allSessions.length >= 20) {
        break;
      }
    }

    // Return the 5 most recent sessions (from the end of the collection)
    const sessions = allSessions.slice(-5);

    return res.status(200).json({ sessions });
  } catch (error: unknown) {
    console.error('Preview generation failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: (error as Error).message });
  }
}
