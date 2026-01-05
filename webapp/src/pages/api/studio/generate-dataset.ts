import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import archiver from 'archiver';

import { jobStore } from '@/lib/jobStore';
import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Next.js API Configuration
 * - bodyParser: Increased limit to handle large thread selection payloads.
 * - externalResolver: Enabled to support manual response streaming via archiver.
 * - runtime: Forced nodejs to allow usage of native fs and archiver modules.
 */
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
  maxTokensPerSession?: number;
  maxTokensPerFile?: number;
  splitDataset?: boolean;
  personaTag?: string;
  customInstructions?: string;
  skipSystemMessages?: boolean;
  datasetName?: string;
  dateRange?: { start: number; end: number };
}

async function processJob(jobId: string, body: GenerateDatasetBody) {
  try {
    jobStore.update(jobId, { status: 'processing' });

    await new Promise((r) => setTimeout(r, 100));

    const {
      threadIds,
      identityNames: uiNames,
      includeGroupSpeakerNames,
      mergeSequential,
      removeSystemMessages,
      imputeReactions,
      redactPII,
      maxTokensPerSession,
      maxTokensPerFile,
      splitDataset,
      personaTag,
      customInstructions,
      skipSystemMessages,
      datasetName,
      dateRange,
    } = body;

    // FAIL-SAFE: Automatically fetch all known identity names/emails from DB
    // to ensure 'isMe' logic works even if UI config is incomplete.
    const { getMyNames } = await import('@/lib/server/identity');
    const dbNames = await getMyNames();
    const identityNames = [...new Set([...uiNames, ...dbNames])];

    // Prepare Output Stream
    const tmpDir = os.tmpdir();
    const fileName = `dataset_${jobId}.zip`;
    const filePath = path.join(tmpDir, fileName);
    const outputStream = fs.createWriteStream(filePath);

    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    // Promise to track when I/O is actually done
    const streamFinished = new Promise<void>((resolve, reject) => {
      outputStream.on('close', resolve);
      archive.on('error', reject);
      outputStream.on('error', reject);
    });

    archive.pipe(outputStream);

    const generator = new DatasetGenerator({
      includeGroupSpeakerNames: !!includeGroupSpeakerNames,
      mergeSequential: !!mergeSequential,
      removeSystemMessages: !!removeSystemMessages,
      imputeReactions: !!imputeReactions,
      redactPII: !!redactPII,
      maxTokensPerSession: maxTokensPerSession || Infinity,
      maxTokensPerFile: maxTokensPerFile || (splitDataset ? 1900000 : Number.MAX_SAFE_INTEGER),
      personaTag: personaTag || undefined,
      customInstructions: customInstructions || undefined,
      skipSystemMessages: !!skipSystemMessages,
      datasetName: datasetName || undefined,
    });

    generator.setDb(db.get());

    // Pass progress callback
    const generatorStream = generator.generateStream(threadIds, identityNames, dateRange, (current, total) => {
      // Update progress in store
      jobStore.update(jobId, {
        progress: current,
        total: total,
      });
    });

    let partCount = 0;
    for await (const file of generatorStream) {
      archive.append(file.content, { name: file.fileName });
      partCount++;
    }

    if (partCount === 0) {
      await archive.abort();
      throw new Error(
        'No valid training data found in selection. Ensure you selected threads where you are an active participant.',
      );
    }

    // Finalize the zip (writes central directory)
    await archive.finalize();
    await streamFinished;

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

    try {
      await fs.promises.access(job.resultPath);
    } catch {
      return res.status(500).json({ error: 'Result file missing from server disk' });
    }

    const stat = await fs.promises.stat(job.resultPath);

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
      jobStore.cleanup(3600000, async (job) => {
        if (job.resultPath) {
          try {
            await fs.promises.access(job.resultPath);
            await fs.promises.unlink(job.resultPath);
            console.log(`Cleaned up artifact for job ${job.id}`);
          } catch {
            // access failed (file not there) or unlink failed
            // Ignore "not found" errors during cleanup
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
