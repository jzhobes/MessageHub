import type { NextApiRequest, NextApiResponse } from 'next';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import { jobStore } from '@/lib/jobStore';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    externalResolver: true,
  },
  runtime: 'nodejs',
};

interface GenerateDatasetBody {
  threadIds: string[];
  identityNames: string[];
  includeGroupSpeakerNames?: boolean;
  mergeSequential?: boolean;
  removeSystemMessages?: boolean;
  imputeReactions?: boolean;
  redactPII?: boolean;
  personaTag?: string;
  customInstructions?: string;
  dateRange?: { start: number; end: number };
}

async function processJob(jobId: string, body: GenerateDatasetBody) {
  try {
    jobStore.update(jobId, { status: 'processing' });

    // Safety delay to ensure checking logic works
    await new Promise((r) => setTimeout(r, 100));

    const { threadIds, identityNames, includeGroupSpeakerNames, mergeSequential, removeSystemMessages, imputeReactions, redactPII, personaTag, customInstructions, dateRange } = body;

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

    // Pass progress callback
    const generatorStream = generator.generateStream(threadIds, identityNames, dateRange, (current, total) => {
      // Update progress in store
      // We debounce slightly to avoid map spam if needed, but for local Map it's fast enough.
      jobStore.update(jobId, {
        progress: current,
        total: total,
      });
    });

    let partCount = 0;
    for await (const file of generatorStream) {
      zip.file(file.fileName, file.content);
      partCount++;
    }

    if (partCount === 0) {
      throw new Error('No valid training data found in selection. Ensure you selected threads where you are an active participant.');
    }

    // Generate ZIP
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

    // Write to temp disk
    const tmpDir = os.tmpdir();
    const fileName = `dataset_${jobId}.zip`;
    const filePath = path.join(tmpDir, fileName);

    fs.writeFileSync(filePath, zipContent);

    jobStore.update(jobId, { status: 'completed', resultPath: filePath });
  } catch (error: unknown) {
    console.error(`Job ${jobId} failed:`, error);
    jobStore.update(jobId, { status: 'failed', error: (error as Error).message || 'Unknown error' });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Download Handling
  if (req.method === 'GET') {
    const { jobId } = req.query;
    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'Missing jobId' });
    }

    const job = jobStore.get(jobId);
    if (!job || job.status !== 'completed' || !job.resultPath) {
      return res.status(404).json({ error: 'Job not found or not completed' });
    }

    if (!fs.existsSync(job.resultPath)) {
      return res.status(500).json({ error: 'Result file missing from server disk' });
    }

    const stat = fs.statSync(job.resultPath);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=virtual_me_dataset.zip');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(job.resultPath);
    readStream.pipe(res);
    return;
  }

  // 2. Job Creation Handling
  if (req.method === 'POST') {
    try {
      const { threadIds, identityNames } = req.body;

      if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
        return res.status(400).json({ error: 'Missing threadIds' });
      }
      if (!identityNames || !Array.isArray(identityNames) || identityNames.length === 0) {
        return res.status(400).json({ error: 'Missing identityNames' });
      }

      // Run cleanup of old jobs (older than 1 hour)
      jobStore.cleanup(3600000, (job) => {
        if (job.resultPath && fs.existsSync(job.resultPath)) {
          try {
            fs.unlinkSync(job.resultPath);
            console.log(`Cleaned up artifact for job ${job.id}`);
          } catch (e) {
            console.error(`Failed to delete artifact for job ${job.id}`, e);
          }
        }
      });

      const jobId = crypto.randomUUID();
      jobStore.create(jobId);

      // Start processing in background (FIRE AND FORGET)
      processJob(jobId, req.body);

      // Return ID immediately
      return res.status(202).json({ jobId });
    } catch (error: unknown) {
      console.error('Job creation failed:', error);
      return res.status(500).json({ error: 'Internal Server Error', details: (error as Error).message });
    }
  }

  res.setHeader('Allow', ['POST', 'GET']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
