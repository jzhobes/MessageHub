import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ZipArchive } from 'archiver';

import { jobStore } from '@/lib/jobStore';
import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';
import { getDatasetBaseName } from '@/lib/shared/dataset/datasetFilename';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Allow large thread selections in the request body. Use the external resolver for archive
 * streaming and the Node.js runtime for filesystem and archiver access.
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
  outputFormat?: 'jsonl' | 'markdown';
  selectedDaysByThread?: Record<string, string[]>;
  timeZone?: string;
}

/**
 * Build the dataset in the background, write a temporary ZIP, and track progress in `jobStore`. Use
 * the identities from SQLite if the UI list is incomplete.
 * Fail the job if generation produces no valid training parts.
 */
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
      outputFormat,
      selectedDaysByThread,
      timeZone,
    } = body;

    // Include the names and emails we know from the database.
    // That lets isMe work even if the UI only supplied some identities.
    const { getMyNames } = await import('@/lib/server/identity');
    const dbNames = await getMyNames();
    const identityNames = [...new Set([...uiNames, ...dbNames])];

    // Prepare Output Stream
    const tmpDir = os.tmpdir();
    const fileName = `dataset_${jobId}.zip`;
    const filePath = path.join(tmpDir, fileName);
    const outputStream = fs.createWriteStream(filePath);

    const archive = new ZipArchive({
      zlib: { level: 9 }, // Maximum compression
    });

    // Wait for the output stream to finish before marking the ZIP ready.
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
      outputFormat: outputFormat || 'jsonl',
      selectedDaysByThread,
      timeZone,
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
      archive.abort();
      throw new Error(
        'No valid training data found in selection. Ensure you selected threads where you are an active participant.',
      );
    }

    // Write the ZIP's central directory before closing it.
    await archive.finalize();
    await streamFinished;

    jobStore.update(jobId, {
      status: 'completed',
      resultPath: filePath,
      downloadFileName: `${getDatasetBaseName(datasetName, outputFormat)}.zip`,
    });
  } catch (error: unknown) {
    console.error('Job %s failed:', jobId, error);
    jobStore.update(jobId, { status: 'failed', error: (error as Error).message || 'Unknown error' });
  }
}

/**
 * POST removes jobs and temporary archives older than an hour, starts generation in the background,
 * and returns 202 with `{ jobId }`.
 * GET with `jobId` streams the finished ZIP.
 */
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
    const downloadFileName = job.downloadFileName ?? 'virtual_me_dataset.zip';
    const fallbackName = downloadFileName.replace(/[^ -~]|"/g, '_');
    const encodedName = encodeURIComponent(downloadFileName.toWellFormed()).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`);
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

      // Remove jobs and ZIPs from more than an hour ago.
      jobStore.cleanup(3600000, async (job) => {
        if (job.resultPath) {
          try {
            await fs.promises.access(job.resultPath);
            await fs.promises.unlink(job.resultPath);
            console.log(`Cleaned up artifact for job ${job.id}`);
          } catch {
            // The file may already be gone, or the delete may have failed.
            // A ZIP that's already gone needs no cleanup.
          }
        }
      });

      const jobId = crypto.randomUUID();
      jobStore.create(jobId);

      // Let generation run after the request returns.
      processJob(jobId, req.body);

      // Give the client the job ID so it can start polling.
      return res.status(202).json({ jobId });
    } catch (error: unknown) {
      console.error('Job creation failed:', error);
      return res.status(500).json({ error: 'Internal Server Error', details: (error as Error).message });
    }
  }

  res.setHeader('Allow', ['POST', 'GET']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
