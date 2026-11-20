// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDemoFetch } from '@/lib/demo/demoRouter';
import { setDemoDataForTest } from '@/lib/demo/demoStore';
import db from '@/lib/server/db';
import contentHandler from '@/pages/api/content';
import identityHandler from '@/pages/api/identity';
import jumpHandler from '@/pages/api/jump';
import mediaGalleryHandler from '@/pages/api/media-gallery';
import searchHandler from '@/pages/api/search';
import statusHandler from '@/pages/api/status';
import datasetThreadsHandler from '@/pages/api/studio/dataset-threads';
import previewDatasetHandler from '@/pages/api/studio/preview-dataset';
import sampleMessagesHandler from '@/pages/api/studio/sample-messages';
import sampleThreadDaysHandler from '@/pages/api/studio/sample-thread-days';
import threadContentHandler from '@/pages/api/studio/thread-content';
import threadsHandler from '@/pages/api/threads';

import type {
  DemoContentRow,
  DemoDataBundle,
  DemoIdentityRow,
  DemoThreadLabelRow,
  DemoThreadRow,
} from '@/lib/demo/demoTypes';
import type { NextApiRequest, NextApiResponse } from 'next';

function buildDemoBundleFromDb(): DemoDataBundle {
  const conn = db.get();
  const hasIdentities = !!conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='identities'").get();
  const identities = hasIdentities
    ? (conn
        .prepare('SELECT platform, id_type, id_value, is_me, metadata_json FROM identities')
        .all() as DemoIdentityRow[])
    : [];
  const threads = conn.prepare('SELECT * FROM threads ORDER BY last_activity_ms DESC').all() as DemoThreadRow[];
  const thread_labels = conn.prepare('SELECT thread_id, label FROM thread_labels').all() as DemoThreadLabelRow[];
  const content = conn.prepare('SELECT * FROM content ORDER BY timestamp_ms ASC, id ASC').all() as DemoContentRow[];

  return {
    identities,
    threads,
    thread_labels,
    content,
    mediaManifest: {},
    linkPreviews: {},
  };
}

async function callRealGet(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>,
  urlPath: string,
) {
  const parsed = new URL(urlPath, 'http://localhost');
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(parsed.searchParams.keys())) {
    const all = parsed.searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    url: urlPath,
    query,
  });
  await handler(req, res);
  return { status: res._getStatusCode(), body: res._getJSONData() };
}

async function callRealPost(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>,
  urlPath: string,
  body: Record<string, unknown>,
) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    url: urlPath,
    body,
  });
  await handler(req, res);
  return { status: res._getStatusCode(), body: res._getJSONData() };
}

describe('Demo Router vs Real API Parity (data_samples)', () => {
  let bundle: DemoDataBundle;

  beforeEach(() => {
    bundle = buildDemoBundleFromDb();
    setDemoDataForTest(bundle);
  });

  afterEach(() => {
    setDemoDataForTest(null);
    vi.restoreAllMocks();
  });

  it('matches /api/status and /api/identity', async () => {
    const realStatus = await callRealGet(statusHandler, '/api/status');
    const demoStatusRes = await handleDemoFetch('/api/status');
    expect(demoStatusRes.status).toBe(realStatus.status);
    expect(await demoStatusRes.json()).toEqual(realStatus.body);

    const realIdentity = await callRealGet(identityHandler, '/api/identity');
    const demoIdentityRes = await handleDemoFetch('/api/identity');
    expect(demoIdentityRes.status).toBe(realIdentity.status);
    expect(await demoIdentityRes.json()).toEqual(realIdentity.body);
  });

  it('matches /api/threads across all 5 platforms', async () => {
    const queries = [
      '/api/threads?platform=facebook&type=message',
      '/api/threads?platform=instagram&type=message',
      '/api/threads?platform=google_chat&type=message',
      '/api/threads?platform=google_mail&type=inbox',
      '/api/threads?platform=google_voice&type=message',
    ];

    for (const q of queries) {
      const real = await callRealGet(threadsHandler, q);
      const demoRes = await handleDemoFetch(q);
      expect(demoRes.status).toBe(real.status);
      expect(await demoRes.json()).toEqual(real.body);
    }
  });

  it('matches /api/content and /api/media-gallery', async () => {
    const contentQueries = [
      '/api/content?threadId=simulation_theory_888&page=1&platform=facebook',
      '/api/content?threadId=gm_1001&page=1&platform=google_mail',
      '/api/content?threadId=DM%20Sarah&page=1&platform=google_chat',
    ];

    for (const q of contentQueries) {
      const real = await callRealGet(contentHandler, q);
      const demoRes = await handleDemoFetch(q);
      expect(demoRes.status).toBe(real.status);
      expect(await demoRes.json()).toEqual(real.body);
    }

    const galleryUrl = '/api/media-gallery?threadId=simulation_theory_888';
    const realGallery = await callRealGet(mediaGalleryHandler, galleryUrl);
    const demoGalleryRes = await handleDemoFetch(galleryUrl);
    expect(demoGalleryRes.status).toBe(realGallery.status);
    expect(await demoGalleryRes.json()).toEqual(realGallery.body);
  });

  it('matches /api/jump in both messageId and date modes', async () => {
    const simMessage = bundle.content.find((m) => m.thread_id === 'simulation_theory_888');
    expect(simMessage).toBeDefined();

    const modeAUrl = `/api/jump?messageId=${simMessage!.id}`;
    const realA = await callRealGet(jumpHandler, modeAUrl);
    const demoARes = await handleDemoFetch(modeAUrl);
    expect(demoARes.status).toBe(realA.status);
    expect(await demoARes.json()).toEqual(realA.body);

    const dateStr = new Date(simMessage!.timestamp_ms).toISOString().slice(0, 10);
    const modeBUrl = `/api/jump?threadId=simulation_theory_888&date=${dateStr}&timeZone=UTC`;
    const realB = await callRealGet(jumpHandler, modeBUrl);
    const demoBRes = await handleDemoFetch(modeBUrl);
    expect(demoBRes.status).toBe(realB.status);
    expect(await demoBRes.json()).toEqual(realB.body);
  });

  it('matches /api/search for plain, OR, platform-filtered, and no-facet queries', async () => {
    const queries = [
      '/api/search?q=simulation',
      '/api/search?q=coffee%20OR%20glitch',
      '/api/search?q=simulation&platform=facebook',
      '/api/search?q=simulation&includeFacets=0',
    ];

    for (const q of queries) {
      const real = await callRealGet(searchHandler, q);
      const demoRes = await handleDemoFetch(q);
      expect(demoRes.status).toBe(real.status);
      expect(await demoRes.json()).toEqual(real.body);
    }
  });

  it('matches DataForge Studio endpoints (/api/studio/*)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1735000000000);

    const dsThreadsUrl = '/api/studio/dataset-threads?platform=all';
    const realDsThreads = await callRealGet(datasetThreadsHandler, dsThreadsUrl);
    const demoDsThreadsRes = await handleDemoFetch(dsThreadsUrl);
    expect(demoDsThreadsRes.status).toBe(realDsThreads.status);
    expect(await demoDsThreadsRes.json()).toEqual(realDsThreads.body);

    const threadContentBody = { ids: ['simulation_theory_888', 'alice_smith_123', 'gm_1001'] };
    const realThreadContent = await callRealPost(threadContentHandler, '/api/studio/thread-content', threadContentBody);
    const demoThreadContentRes = await handleDemoFetch('/api/studio/thread-content', {
      method: 'POST',
      body: JSON.stringify(threadContentBody),
    });
    expect(demoThreadContentRes.status).toBe(realThreadContent.status);
    const demoThreadContent = (await demoThreadContentRes.json()) as Record<string, string[]>;
    const realThreadContentBody = realThreadContent.body as Record<string, string[]>;
    expect(Object.keys(demoThreadContent).sort()).toEqual(Object.keys(realThreadContentBody).sort());
    for (const key of Object.keys(realThreadContentBody)) {
      // SQLite leaves equal-timestamp rows in unspecified query-plan order
      expect([...demoThreadContent[key]].sort()).toEqual([...realThreadContentBody[key]].sort());
    }

    const sampleMsgsBody = { threadIds: ['simulation_theory_888', 'gm_1001'], limit: 50 };
    const realSampleMsgs = await callRealPost(sampleMessagesHandler, '/api/studio/sample-messages', sampleMsgsBody);
    const demoSampleMsgsRes = await handleDemoFetch('/api/studio/sample-messages', {
      method: 'POST',
      body: JSON.stringify(sampleMsgsBody),
    });
    expect(demoSampleMsgsRes.status).toBe(realSampleMsgs.status);
    const demoSampleMsgs = (await demoSampleMsgsRes.json()) as { messages: string[] };
    const realSampleMsgsBody = realSampleMsgs.body as { messages: string[] };
    expect([...demoSampleMsgs.messages].sort()).toEqual([...realSampleMsgsBody.messages].sort());

    const sampleDaysBody = {
      threadIds: ['simulation_theory_888', 'gm_1001'],
      identityNames: ['John Doe'],
      timeZone: 'UTC',
    };
    const realSampleDays = await callRealPost(
      sampleThreadDaysHandler,
      '/api/studio/sample-thread-days',
      sampleDaysBody,
    );
    const demoSampleDaysRes = await handleDemoFetch('/api/studio/sample-thread-days', {
      method: 'POST',
      body: JSON.stringify(sampleDaysBody),
    });
    expect(demoSampleDaysRes.status).toBe(realSampleDays.status);
    expect(await demoSampleDaysRes.json()).toEqual(realSampleDays.body);

    const jsonlPreviewBody = {
      threadIds: ['simulation_theory_888', 'gm_1001'],
      identityNames: ['John Doe'],
      outputFormat: 'jsonl',
    };
    const realJsonlPreview = await callRealPost(previewDatasetHandler, '/api/studio/preview-dataset', jsonlPreviewBody);
    const demoJsonlPreviewRes = await handleDemoFetch('/api/studio/preview-dataset', {
      method: 'POST',
      body: JSON.stringify(jsonlPreviewBody),
    });
    expect(demoJsonlPreviewRes.status).toBe(realJsonlPreview.status);
    expect(await demoJsonlPreviewRes.json()).toEqual(realJsonlPreview.body);

    const mdPreviewBody = {
      threadIds: ['simulation_theory_888', 'gm_1001'],
      identityNames: ['John Doe'],
      outputFormat: 'markdown',
      datasetName: 'parity_test',
      skipSystemMessages: true,
      timeZone: 'UTC',
    };
    const realMdPreview = await callRealPost(previewDatasetHandler, '/api/studio/preview-dataset', mdPreviewBody);
    const demoMdPreviewRes = await handleDemoFetch('/api/studio/preview-dataset', {
      method: 'POST',
      body: JSON.stringify(mdPreviewBody),
    });
    expect(demoMdPreviewRes.status).toBe(realMdPreview.status);
    expect(await demoMdPreviewRes.json()).toEqual(realMdPreview.body);
  });
});
