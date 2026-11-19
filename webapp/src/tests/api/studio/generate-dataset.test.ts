// @vitest-environment node
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jobStore } from '@/lib/jobStore';
import { DatasetGenerator } from '@/lib/server/DatasetGenerator';
import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/studio/generate-dataset';

import { createStreamingMocks, waitForStreamEnd } from '../../helpers/httpHelpers';
import { createMemoryDb, seedMessage, seedThread } from '../../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/studio/generate-dataset', () => {
  let memDb: Database.Database | null = null;
  const filesToCleanup: string[] = [];

  beforeEach(() => {
    vi.mocked(getMyNames).mockResolvedValue(['Me']);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (memDb) {
      memDb.close();
      memDb = null;
    }
    while (filesToCleanup.length > 0) {
      const f = filesToCleanup.pop();
      if (f && fs.existsSync(f)) {
        fs.rmSync(f, { force: true });
      }
    }
  });

  it('returns 405 on unsupported HTTP methods', async () => {
    const { req, res } = createMocks({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST', 'GET']);
  });

  it('GET returns 400 when jobId is missing or an array', async () => {
    const missing = createMocks({ method: 'GET', query: {} });
    await handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(400);

    const arr = createMocks({ method: 'GET', query: { jobId: ['a', 'b'] } });
    await handler(arr.req, arr.res);
    expect(arr.res._getStatusCode()).toBe(400);
  });

  it('GET returns 404 when job is missing, incomplete, or lacks resultPath', async () => {
    const missingCall = createMocks({ method: 'GET', query: { jobId: 'unknown-job-id' } });
    await handler(missingCall.req, missingCall.res);
    expect(missingCall.res._getStatusCode()).toBe(404);

    const pendingId = `gen-pending-${crypto.randomUUID()}`;
    jobStore.create(pendingId);
    const pendingCall = createMocks({ method: 'GET', query: { jobId: pendingId } });
    await handler(pendingCall.req, pendingCall.res);
    expect(pendingCall.res._getStatusCode()).toBe(404);

    const noPathId = `gen-nopath-${crypto.randomUUID()}`;
    jobStore.create(noPathId);
    jobStore.update(noPathId, { status: 'completed' });
    const noPathCall = createMocks({ method: 'GET', query: { jobId: noPathId } });
    await handler(noPathCall.req, noPathCall.res);
    expect(noPathCall.res._getStatusCode()).toBe(404);
  });

  it('GET returns 500 when completed job file is missing on disk', async () => {
    const jobId = `gen-missing-file-${crypto.randomUUID()}`;
    jobStore.create(jobId);
    jobStore.update(jobId, {
      status: 'completed',
      resultPath: path.join(os.tmpdir(), `does-not-exist-${jobId}.zip`),
    });

    const { req, res } = createMocks({ method: 'GET', query: { jobId } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Result file missing from server disk' });
  });

  it('POST validates body, runs background zip job, updates jobStore, and downloads zip via GET', async () => {
    const missingThreads = createMocks({ method: 'POST', body: { identityNames: ['Me'] } });
    await handler(missingThreads.req, missingThreads.res);
    expect(missingThreads.res._getStatusCode()).toBe(400);

    const missingIdentities = createMocks({ method: 'POST', body: { threadIds: ['t1'], identityNames: [] } });
    await handler(missingIdentities.req, missingIdentities.res);
    expect(missingIdentities.res._getStatusCode()).toBe(400);

    memDb = createMemoryDb();
    seedThread(memDb, { id: 't1', platform: 'facebook', title: 'Chat', participants: ['Me', 'Alice'] });
    seedMessage(memDb, { thread_id: 't1', sender_name: 'Alice', timestamp_ms: 1000, content: 'Hey there?' });
    seedMessage(memDb, { thread_id: 't1', sender_name: 'Me', timestamp_ms: 2000, content: 'All good here!' });

    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const postCall = createMocks({
      method: 'POST',
      body: {
        threadIds: ['t1'],
        identityNames: ['Me'],
        datasetName: 'unit-ds',
      },
    });
    await handler(postCall.req, postCall.res);

    expect(postCall.res._getStatusCode()).toBe(202);
    const { jobId } = postCall.res._getJSONData();
    expect(typeof jobId).toBe('string');

    await vi.waitFor(() => {
      const job = jobStore.get(jobId);
      expect(job?.status).toBe('completed');
    });

    const completedJob = jobStore.get(jobId)!;
    expect(completedJob.resultPath).toBeTruthy();
    filesToCleanup.push(completedJob.resultPath!);
    expect(fs.existsSync(completedJob.resultPath!)).toBe(true);

    const getCall = createStreamingMocks({ method: 'GET', query: { jobId } });
    await handler(getCall.req, getCall.res);
    await waitForStreamEnd(getCall.res);

    expect(getCall.res._getStatusCode()).toBe(200);
    expect(getCall.res._getHeaders()['content-type']).toBe('application/zip');
    expect(getCall.res._getHeaders()['content-disposition']).toBe('attachment; filename=virtual_me_dataset.zip');

    const zipBuffer = getCall.res._getBuffer();
    // ZIP magic bytes: 'PK'
    expect(zipBuffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('marks background job as failed when generator produces zero parts and cleans up stale job files on POST', async () => {
    memDb = createMemoryDb();
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const staleId = `gen-stale-${crypto.randomUUID()}`;
    const staleZipPath = path.join(os.tmpdir(), `stale-${staleId}.zip`);
    fs.writeFileSync(staleZipPath, 'old-zip');
    filesToCleanup.push(staleZipPath);

    const staleJob = jobStore.create(staleId);
    staleJob.createdAt = Date.now() - 4000000;
    staleJob.resultPath = staleZipPath;

    vi.spyOn(DatasetGenerator.prototype, 'generateStream').mockImplementation(async function* () {
      // Yield nothing
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['t1'], identityNames: ['Me'] },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(202);
    const { jobId } = res._getJSONData();
    filesToCleanup.push(path.join(os.tmpdir(), `dataset_${jobId}.zip`));

    await vi.waitFor(() => {
      const job = jobStore.get(jobId);
      expect(job?.status).toBe('failed');
    });

    expect(jobStore.get(jobId)?.error).toContain('No valid training data found in selection');
    await vi.waitFor(() => {
      expect(fs.existsSync(staleZipPath)).toBe(false);
    });
    expect(jobStore.get(staleId)).toBeUndefined();
  });

  it('POST returns 500 if synchronous job creation fails', async () => {
    vi.spyOn(jobStore, 'create').mockImplementationOnce(() => {
      throw new Error('Store full');
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { threadIds: ['t1'], identityNames: ['Me'] },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error', details: 'Store full' });
  });
});
