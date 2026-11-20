import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';
import { DatasetEntry } from '@/lib/shared/types';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Preview dataset formatting on POST. Run `DatasetGenerator` on up to three selected threads, with
 * 100k tokens per file and at most 20 parsed sessions. Return the five most recent sessions
 * collected.
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

    // A few threads are enough to show the format.
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

      // Stop at 20 sessions so a large thread doesn't slow down the preview.
      if (allSessions.length >= 20) {
        break;
      }
    }

    // Take the last five sessions in the collection.
    const sessions = allSessions.slice(-5);

    return res.status(200).json({ sessions });
  } catch (error: unknown) {
    console.error('Preview generation failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: (error as Error).message });
  }
}
