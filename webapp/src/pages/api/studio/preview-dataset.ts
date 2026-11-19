import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';
import { DatasetEntry } from '@/lib/shared/types';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Generates a fast dataset formatting preview (`POST`) by running `DatasetGenerator` on at most the
 * first 3 selected threads (capped at 100k tokens/file and 20 parsed sessions) and returning the
 * 5 most recent sessions.
 */
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
    outputFormat,
    selectedDaysByThread,
    datasetName,
    timeZone,
  } = req.body;

  if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
    return res.status(400).json({ error: 'Missing threadIds' });
  }

  if (!identityNames || !Array.isArray(identityNames) || identityNames.length === 0) {
    return res.status(400).json({ error: 'Missing identityNames' });
  }

  try {
    const isMarkdown = outputFormat === 'markdown';

    const generator = new DatasetGenerator({
      includeGroupSpeakerNames: !!includeGroupSpeakerNames,
      mergeSequential: !!mergeSequential,
      removeSystemMessages: !!removeSystemMessages,
      imputeReactions: !!imputeReactions,
      redactPII: !!redactPII,
      personaTag: personaTag || undefined,
      customInstructions: customInstructions || undefined,
      skipSystemMessages: !!skipSystemMessages,
      datasetName: datasetName || 'virtual_me',
      outputFormat: isMarkdown ? 'markdown' : 'jsonl',
      selectedDaysByThread,
      timeZone,
      includeSummary: false,
      maxTokensPerSession: Infinity,
      maxTokensPerFile: 100000, // Small limit for preview
    });

    generator.setDb(db.get());

    // We only take a few threads for the preview
    const previewThreadIds = (threadIds as string[]).slice(0, 3);
    const recordsStream = generator.generateRecords(previewThreadIds, identityNames, dateRange);

    if (isMarkdown) {
      const files: { fileName: string; content: string }[] = [];
      const MAX_PREVIEW_CHARS = 12000;
      for await (const record of recordsStream) {
        if (record.kind === 'markdown') {
          const content =
            record.content.length > MAX_PREVIEW_CHARS
              ? `${record.content.slice(0, MAX_PREVIEW_CHARS)}\n\n... (truncated for preview)`
              : record.content;
          files.push({ fileName: record.fileName, content });
        }
      }
      return res.status(200).json({ format: 'markdown', files });
    }

    const allSessions: DatasetEntry[] = [];

    for await (const record of recordsStream) {
      if (record.kind === 'session') {
        allSessions.push(record.entry);
      } else {
        allSessions.push({
          messages: [{ role: 'assistant', content: record.content }],
        });
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
