import type { NextApiRequest, NextApiResponse } from 'next';
import JSZip from 'jszip';
import { DatasetGenerator } from '@/lib/server/DatasetGenerator';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    externalResolver: true,
  },
  // Force Node.js runtime for Tiktoken/WASM support
  runtime: 'nodejs',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    // Parse body (Next.js automatically parses JSON body)
    const { threadIds, identityNames, includeGroupSpeakerNames, mergeSequential, removeSystemMessages, imputeReactions, redactPII, personaTag, customInstructions, dateRange } = req.body;

    if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
      return res.status(400).json({ error: 'Missing threadIds' });
    }
    if (!identityNames || !Array.isArray(identityNames) || identityNames.length === 0) {
      return res.status(400).json({ error: 'Missing identityNames' });
    }

    const generator = new DatasetGenerator({
      includeGroupSpeakerNames: !!includeGroupSpeakerNames,
      mergeSequential: !!mergeSequential,
      removeSystemMessages: !!removeSystemMessages,
      imputeReactions: !!imputeReactions,
      redactPII: !!redactPII,
      personaTag: personaTag || undefined,
      customInstructions: customInstructions || undefined,
    });

    const zip = new JSZip();
    // Assuming dateRange is optional or properly formatted
    const generatorStream = generator.generateStream(threadIds, identityNames, dateRange);

    let partCount = 0;
    for (const file of generatorStream) {
      zip.file(file.fileName, file.content);
      partCount++;
    }

    if (partCount === 0) {
      return res.status(400).json({ error: 'No valid training data found in selection. Ensure you selected threads where you are an active participant.' });
    }

    // Generate ZIP
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=virtual_me_dataset.zip');
    res.setHeader('Content-Length', zipContent.length);
    res.status(200).end(zipContent);
  } catch (error) {
    console.error('Dataset generation failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal Server Error', details: message });
  }
}
