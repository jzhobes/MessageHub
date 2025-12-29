import { DatasetGenerator } from '@/lib/server/DatasetGenerator';

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
      maxTokensPerFile: 100000, // Small limit for preview
    });

    // We only take a few threads for the preview
    const previewThreadIds = (threadIds as string[]).slice(0, 3);
    const generatorStream = generator.generateStream(previewThreadIds, identityNames);

    const sessions: import('@/lib/server/DatasetGenerator').DatasetEntry[] = [];
    let count = 0;

    for await (const part of generatorStream) {
      // The stream yields file parts, we want to parse the sessions back out
      const lines = part.content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          sessions.push(JSON.parse(line));
          count++;
        }
        if (count >= 5) {
          break;
        } // Only peek at first 5 sessions
      }
      if (count >= 5) {
        break;
      }
    }

    return res.status(200).json({ sessions });
  } catch (error: unknown) {
    console.error('Preview generation failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: (error as Error).message });
  }
}
