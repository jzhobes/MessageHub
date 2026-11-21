// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

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

const facebookThreadId = 'cabin-weekend_1';
const chatThreadId = 'Space Field Notes';
const mailThreadId = 'gm_8017';

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
  expect(res._getStatusCode(), urlPath).toBe(200);
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
  expect(res._getStatusCode(), urlPath).toBe(200);
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
    expect(realStatus.body).toHaveProperty('initialized', true);
    expect(demoStatusRes.status).toBe(realStatus.status);
    expect(await demoStatusRes.json()).toEqual(realStatus.body);

    const realIdentity = await callRealGet(identityHandler, '/api/identity');
    const demoIdentityRes = await handleDemoFetch('/api/identity');
    expect(realIdentity.body).toHaveProperty('names', expect.arrayContaining(['Alex Smith']));
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
      expect(real.body, q).toHaveProperty('threads.0');
      expect(demoRes.status).toBe(real.status);
      expect(await demoRes.json()).toEqual(real.body);
    }
  });

  it('matches /api/content and /api/media-gallery', async () => {
    const contentQueries = [
      `/api/content?threadId=${facebookThreadId}&page=1&platform=facebook`,
      `/api/content?threadId=${mailThreadId}&page=1&platform=google_mail`,
      `/api/content?threadId=${encodeURIComponent(chatThreadId)}&page=1&platform=google_chat`,
    ];

    for (const q of contentQueries) {
      const real = await callRealGet(contentHandler, q);
      const demoRes = await handleDemoFetch(q);
      expect(real.body, q).toHaveProperty('records.0');
      expect(demoRes.status).toBe(real.status);
      expect(await demoRes.json()).toEqual(real.body);
    }

    const galleryUrl = `/api/media-gallery?threadId=${mailThreadId}`;
    const realGallery = await callRealGet(mediaGalleryHandler, galleryUrl);
    const demoGalleryRes = await handleDemoFetch(galleryUrl);
    expect(realGallery.body).toHaveProperty('media.0');
    expect(demoGalleryRes.status).toBe(realGallery.status);
    expect(await demoGalleryRes.json()).toEqual(realGallery.body);
  });

  it('paginates the long sample conversations without gaps and jumps to older pages', async () => {
    const examples = [
      { title: 'Field Notes launch', minimumPages: 3 },
      { title: 'Emma Wilson', minimumPages: 2 },
      { title: 'Field Notes refresh — agreed scope', minimumPages: 2 },
    ];

    for (const { title, minimumPages } of examples) {
      const thread = bundle.threads.find((row) => row.title === title);
      assert(thread, `Missing sample conversation: ${title}`);
      const messages = bundle.content
        .filter((row) => row.thread_id === thread.id)
        .sort((a, b) => b.timestamp_ms - a.timestamp_ms || b.id - a.id);
      const pageCount = Math.ceil(messages.length / 100);
      expect(pageCount, title).toBeGreaterThanOrEqual(minimumPages);

      for (let page = 1; page <= pageCount + 1; page++) {
        const url = `/api/content?threadId=${encodeURIComponent(thread.id)}&page=${page}`;
        const real = await callRealGet(contentHandler, url);
        const demo = await handleDemoFetch(url);
        expect(demo.status).toBe(200);
        expect(await demo.json()).toEqual(real.body);
        const expectedPage = messages.slice((page - 1) * 100, page * 100);
        expect(real.body, `${title}, page ${page}`).toMatchObject({
          records: expectedPage.map((row) => ({ id: String(row.id) })),
        });
      }

      const oldest = messages[messages.length - 1];
      const jumpUrl = `/api/jump?messageId=${oldest.id}`;
      const realJump = await callRealGet(jumpHandler, jumpUrl);
      const demoJump = await handleDemoFetch(jumpUrl);
      expect(await demoJump.json()).toEqual(realJump.body);
      expect(realJump.body).toHaveProperty('page', pageCount);
    }
  });

  it('matches /api/jump in both messageId and date modes', async () => {
    const message = bundle.content.find((m) => m.thread_id === facebookThreadId);
    assert(message, `Expected a message in ${facebookThreadId}`);

    const modeAUrl = `/api/jump?messageId=${message.id}`;
    const realA = await callRealGet(jumpHandler, modeAUrl);
    const demoARes = await handleDemoFetch(modeAUrl);
    expect(demoARes.status).toBe(realA.status);
    expect(await demoARes.json()).toEqual(realA.body);

    const dateStr = new Date(message.timestamp_ms).toISOString().slice(0, 10);
    const modeBUrl = `/api/jump?threadId=${facebookThreadId}&date=${dateStr}&timeZone=UTC`;
    const realB = await callRealGet(jumpHandler, modeBUrl);
    const demoBRes = await handleDemoFetch(modeBUrl);
    expect(demoBRes.status).toBe(realB.status);
    expect(await demoBRes.json()).toEqual(realB.body);
  });

  it('matches /api/search for plain, OR, platform-filtered, and no-facet queries', async () => {
    const queries = [
      '/api/search?q=fern%20house',
      '/api/search?q=fern%20house%20OR%20lentil',
      '/api/search?q=fern%20house&platform=facebook',
      '/api/search?q=fern%20house&includeFacets=0',
    ];

    for (const q of queries) {
      const real = await callRealGet(searchHandler, q);
      const demoRes = await handleDemoFetch(q);
      expect(real.body, q).toHaveProperty('data.0');
      expect(demoRes.status).toBe(real.status);
      expect(await demoRes.json()).toEqual(real.body);
    }
  });

  it('matches DataForge Studio endpoints (/api/studio/*)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2025, 6, 1));
    const threadIds = [facebookThreadId, mailThreadId];
    const identityNames = ['Alex Smith', 'alex.smith@example.com'];

    const dsThreadsUrl = '/api/studio/dataset-threads?platform=all';
    const realDsThreads = await callRealGet(datasetThreadsHandler, dsThreadsUrl);
    const demoDsThreadsRes = await handleDemoFetch(dsThreadsUrl);
    expect(realDsThreads.body).toContainEqual(expect.objectContaining({ id: 'David Smith', myAvgMessageLength: 37 }));
    expect(demoDsThreadsRes.status).toBe(realDsThreads.status);
    expect(await demoDsThreadsRes.json()).toEqual(realDsThreads.body);

    const threadContentBody = { ids: [...threadIds, chatThreadId] };
    const realThreadContent = await callRealPost(threadContentHandler, '/api/studio/thread-content', threadContentBody);
    const demoThreadContentRes = await handleDemoFetch('/api/studio/thread-content', {
      method: 'POST',
      body: JSON.stringify(threadContentBody),
    });
    expect(demoThreadContentRes.status).toBe(realThreadContent.status);
    const demoThreadContent = (await demoThreadContentRes.json()) as Record<string, string[]>;
    const realThreadContentBody = realThreadContent.body as Record<string, string[]>;
    expect(Object.keys(realThreadContentBody).sort()).toEqual([...threadContentBody.ids].sort());
    expect(Object.keys(demoThreadContent).sort()).toEqual([...threadContentBody.ids].sort());
    for (const key of threadContentBody.ids) {
      expect(realThreadContentBody[key].length, key).toBeGreaterThan(0);
      // SQLite can return rows with the same timestamp in either order.
      expect([...demoThreadContent[key]].sort()).toEqual([...realThreadContentBody[key]].sort());
    }

    const sampleMsgsBody = { threadIds, limit: 50 };
    const realSampleMsgs = await callRealPost(sampleMessagesHandler, '/api/studio/sample-messages', sampleMsgsBody);
    const demoSampleMsgsRes = await handleDemoFetch('/api/studio/sample-messages', {
      method: 'POST',
      body: JSON.stringify(sampleMsgsBody),
    });
    expect(demoSampleMsgsRes.status).toBe(realSampleMsgs.status);
    const demoSampleMsgs = (await demoSampleMsgsRes.json()) as { messages: string[] };
    const realSampleMsgsBody = realSampleMsgs.body as { messages: string[] };
    expect(realSampleMsgsBody.messages.length).toBeGreaterThan(0);
    expect([...demoSampleMsgs.messages].sort()).toEqual([...realSampleMsgsBody.messages].sort());

    const sampleDaysBody = {
      threadIds,
      identityNames,
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
    for (const threadId of threadIds) {
      expect(realSampleDays.body).toHaveProperty(['results', threadId, 'selectedDays', '0']);
    }
    expect(demoSampleDaysRes.status).toBe(realSampleDays.status);
    expect(await demoSampleDaysRes.json()).toEqual(realSampleDays.body);

    const jsonlPreviewBody = {
      threadIds,
      identityNames,
      outputFormat: 'jsonl',
    };
    const realJsonlPreview = await callRealPost(previewDatasetHandler, '/api/studio/preview-dataset', jsonlPreviewBody);
    const demoJsonlPreviewRes = await handleDemoFetch('/api/studio/preview-dataset', {
      method: 'POST',
      body: JSON.stringify(jsonlPreviewBody),
    });
    expect(realJsonlPreview.body).toHaveProperty('sessions.0');
    expect(demoJsonlPreviewRes.status).toBe(realJsonlPreview.status);
    expect(await demoJsonlPreviewRes.json()).toEqual(realJsonlPreview.body);

    const mdPreviewBody = {
      threadIds,
      identityNames,
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
    expect(realMdPreview.body).toHaveProperty('files.0');
    expect(demoMdPreviewRes.status).toBe(realMdPreview.status);
    expect(await demoMdPreviewRes.json()).toEqual(realMdPreview.body);
  });
});
