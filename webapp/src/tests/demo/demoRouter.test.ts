// @vitest-environment node
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDemoJobDownloadUrl, handleDemoFetch } from '@/lib/demo/demoRouter';
import { setDemoDataForTest } from '@/lib/demo/demoStore';

import type { DemoDataBundle } from '@/lib/demo/demoTypes';

const TEST_BUNDLE: DemoDataBundle = {
  identities: [{ platform: 'facebook', id_type: 'name', id_value: 'John Doe', is_me: 1 }],
  threads: [
    {
      id: 'fb_chat_1',
      platform: 'facebook',
      title: null,
      participants_json: JSON.stringify(['John Doe', 'Alice Smith']),
      is_group: 0,
      last_activity_ms: 1700003000000,
      snippet: 'See you at coffee!',
    },
    {
      id: 'fb_post_1',
      platform: 'facebook',
      title: 'Shared a note',
      participants_json: JSON.stringify(['John Doe']),
      is_group: 0,
      last_activity_ms: 1700004000000,
      snippet: 'Weekend hike was awesome',
    },
    {
      id: 'fb_evt_1',
      platform: 'facebook',
      title: 'Tech Meetup',
      participants_json: JSON.stringify(['John Doe']),
      is_group: 0,
      last_activity_ms: 1700005000000,
      snippet: 'Created Event',
    },
    {
      id: 'gm_1',
      platform: 'google_mail',
      title: 'Project Release',
      participants_json: JSON.stringify(['John Doe', 'bob@example.com']),
      is_group: 0,
      last_activity_ms: 1700006000000,
      snippet: 'Looks good to ship',
    },
  ],
  thread_labels: [
    { thread_id: 'fb_chat_1', label: 'message' },
    { thread_id: 'fb_post_1', label: 'post' },
    { thread_id: 'fb_evt_1', label: 'event' },
    { thread_id: 'gm_1', label: 'inbox' },
    { thread_id: 'gm_1', label: 'sent' },
  ],
  content: [
    {
      id: 1,
      thread_id: 'fb_chat_1',
      sender_name: 'Alice Smith',
      timestamp_ms: 1700001000000,
      content: 'Hey John, free for coffee tomorrow?',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 2,
      thread_id: 'fb_chat_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700001100000,
      content: 'Yes! Check out this glitch photo too.',
      media_json: JSON.stringify([{ uri: 'messages/inbox/fb_chat_1/photos/glitch.jpg', type: 'photo' }]),
      reactions_json: JSON.stringify([{ reaction: '👍', actor: 'Alice Smith' }]),
      share_json: null,
      annotations_json: null,
    },
    {
      id: 3,
      thread_id: 'fb_chat_1',
      sender_name: 'Alice Smith',
      timestamp_ms: 1700001200000,
      content: 'Haha love it',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 4,
      thread_id: 'fb_chat_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700001300000,
      content: 'Bringing my espresso setup to the studio',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 5,
      thread_id: 'fb_chat_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700002000000,
      content: 'Also let me know when you arrive',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 6,
      thread_id: 'fb_chat_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700002500000,
      content: 'Wait on second thought let us meet at 10',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 7,
      thread_id: 'fb_chat_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700003000000,
      content: 'See you at coffee!',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 8,
      thread_id: 'fb_post_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700004000000,
      content: 'Weekend hike was awesome',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 9,
      thread_id: 'fb_evt_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700005000000,
      content: 'Created Event',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 10,
      thread_id: 'gm_1',
      sender_name: 'bob@example.com',
      timestamp_ms: 1700005500000,
      content: '<p>Ready to ship the <b>release</b>?</p>',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
    {
      id: 11,
      thread_id: 'gm_1',
      sender_name: 'John Doe',
      timestamp_ms: 1700006000000,
      content: 'Looks good to ship! Email me at john@example.com.',
      media_json: null,
      reactions_json: null,
      share_json: null,
      annotations_json: null,
    },
  ],
  mediaManifest: {
    'facebook::messages/inbox/fb_chat_1/photos/glitch.jpg':
      '/demo/media/facebook/Facebook/your_facebook_activity/messages/inbox/fb_chat_1/photos/glitch.jpg.svg',
  },
  linkPreviews: {},
};

describe('demoRouter', () => {
  beforeEach(() => {
    setDemoDataForTest(TEST_BUNDLE);
  });

  afterEach(() => {
    setDemoDataForTest(null);
    vi.restoreAllMocks();
  });

  it('serves status, identity, and threads including virtual Facebook aggregates', async () => {
    const statusRes = await handleDemoFetch('/api/status');
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({
      initialized: true,
      platforms: {
        facebook: true,
        instagram: false,
        google_chat: false,
        google_mail: true,
        google_voice: false,
      },
    });

    const idRes = await handleDemoFetch('/api/identity');
    expect(await idRes.json()).toEqual({ names: ['Me', 'John Doe'] });

    const fbThreadsRes = await handleDemoFetch('/api/threads?platform=facebook&type=message');
    const fbData = await fbThreadsRes.json();
    expect(fbData.threads).toHaveLength(1);
    expect(fbData.threads[0].title).toBe('Alice Smith');
    expect(fbData.counts).toMatchObject({ message: 1, marketplace: 0, post: 1, event: 1 });

    const fbEventsRes = await handleDemoFetch('/api/threads?platform=facebook&type=event');
    const fbEvents = await fbEventsRes.json();
    expect(fbEvents.threads.find((t: { id: string }) => t.id === 'fb-event-owned')?.snippet).toBe(
      'Latest: Tech Meetup',
    );

    const fbPostsRes = await handleDemoFetch('/api/threads?platform=facebook&type=post');
    const fbPosts = await fbPostsRes.json();
    expect(fbPosts.threads[0].id).toBe('fb-post-all');
  });

  it('transforms content rows, supports jump by messageId and date, and serves media gallery', async () => {
    const contentRes = await handleDemoFetch('/api/content?threadId=fb_chat_1&page=1&platform=facebook');
    const { records } = await contentRes.json();
    // Message 2 has text and a photo, so it should come back as two bubbles.
    expect(records.some((r: { id: string }) => r.id === '2_media')).toBe(true);
    expect(records.some((r: { id: string }) => r.id === '2')).toBe(true);

    const jumpMsgRes = await handleDemoFetch('/api/jump?messageId=8');
    expect(await jumpMsgRes.json()).toMatchObject({
      threadId: 'fb-post-all',
      platform: 'facebook',
      page: 1,
      category: 'post',
    });

    const jumpDateRes = await handleDemoFetch('/api/jump?threadId=fb_chat_1&date=2023-11-14&timeZone=UTC');
    const jumpDate = await jumpDateRes.json();
    expect(jumpDateRes.status).toBe(200);
    expect(jumpDate.threadId).toBe('fb_chat_1');
    expect(jumpDate.page).toBe(1);

    const galleryRes = await handleDemoFetch('/api/media-gallery?threadId=fb_chat_1');
    const gallery = await galleryRes.json();
    expect(gallery.total).toBe(1);
    expect(gallery.media[0].mediaType).toBe('photo');
  });

  it('executes AND/OR search with self-excluding facets and consolidated sender counts', async () => {
    const searchRes = await handleDemoFetch('/api/search?q=coffee%20OR%20ship&platform=facebook');
    expect(searchRes.status).toBe(200);
    const body = await searchRes.json();

    // The Facebook filter should return the two coffee messages from fb_chat_1.
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].snippet).toBeTruthy();

    // Keep Gmail in the platform counts even when Facebook is selected. Both Gmail messages contain “ship.”
    expect(body.facets.platforms).toEqual({ facebook: 2, google_mail: 2 });
    expect(body.facets.senders['John Doe']).toBe(1);
    expect(body.facets.senders['Alice Smith']).toBe(1);
  });

  it('emulates DataForge Studio endpoints and generates an in-browser ZIP archive', async () => {
    const threadsRes = await handleDemoFetch('/api/studio/dataset-threads?platform=all');
    const studioThreads = await threadsRes.json();
    expect(studioThreads.some((t: { id: string }) => t.id === 'fb_chat_1')).toBe(true);
    expect(studioThreads.some((t: { id: string }) => t.id === 'fb-post-all')).toBe(true);

    const threadContentRes = await handleDemoFetch('/api/studio/thread-content', {
      method: 'POST',
      body: JSON.stringify({ ids: ['fb_chat_1', 'fb-post-all'] }),
    });
    const threadContent = await threadContentRes.json();
    expect(threadContent.fb_chat_1.length).toBeGreaterThan(0);
    expect(threadContent['fb-post-all'][0]).toContain('Social post:');

    const sampleRes = await handleDemoFetch('/api/studio/sample-messages', {
      method: 'POST',
      body: JSON.stringify({ threadIds: ['fb_chat_1', 'gm_1'], limit: 10 }),
    });
    const sampleData = await sampleRes.json();
    expect(sampleData.messages.length).toBeGreaterThan(0);

    const daysRes = await handleDemoFetch('/api/studio/sample-thread-days', {
      method: 'POST',
      body: JSON.stringify({
        threadIds: ['fb_chat_1', 'fb-event-owned'],
        identityNames: ['John Doe'],
        timeZone: 'UTC',
      }),
    });
    const daysData = await daysRes.json();
    expect(daysData.results.fb_chat_1.selectedDays.length).toBeGreaterThan(0);
    expect(daysData.results['fb-event-owned']).toMatchObject({ isEvent: true, totalSelectedMsgs: 1 });

    // Markdown preview
    const mdPreviewRes = await handleDemoFetch('/api/studio/preview-dataset', {
      method: 'POST',
      body: JSON.stringify({
        threadIds: ['fb_chat_1', 'gm_1'],
        identityNames: ['John Doe'],
        outputFormat: 'markdown',
        redactPII: true,
        skipSystemMessages: true,
        datasetName: 'demo_me',
        timeZone: 'UTC',
      }),
    });
    const mdPreview = await mdPreviewRes.json();
    expect(mdPreview.format).toBe('markdown');
    expect(mdPreview.files.map((file: { fileName: string }) => file.fileName)).toEqual(['demo_me.md']);

    // JSONL preview
    const jsonlPreviewRes = await handleDemoFetch('/api/studio/preview-dataset', {
      method: 'POST',
      body: JSON.stringify({
        threadIds: ['fb_chat_1'],
        identityNames: ['John Doe'],
        outputFormat: 'jsonl',
      }),
    });
    const jsonlPreview = await jsonlPreviewRes.json();
    expect(jsonlPreview.sessions.length).toBeGreaterThan(0);

    // Generate the full ZIP, poll for completion, and open it with JSZip to check the contents.
    let capturedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      capturedBlob = obj as Blob;
      return 'blob:demo-test';
    });

    const genRes = await handleDemoFetch('/api/studio/generate-dataset', {
      method: 'POST',
      body: JSON.stringify({
        threadIds: ['fb_chat_1', 'gm_1'],
        identityNames: ['John Doe'],
        outputFormat: 'markdown',
        redactPII: true,
        skipSystemMessages: true,
        datasetName: 'demo_me',
        timeZone: 'UTC',
      }),
    });
    expect(genRes.status).toBe(202);
    const { jobId } = await genRes.json();

    let jobStatus = 'pending';
    for (let attempt = 0; attempt < 25; attempt++) {
      const statusRes = await handleDemoFetch(`/api/job-status?id=${jobId}`);
      const statusJson = await statusRes.json();
      jobStatus = statusJson.status;
      if (jobStatus === 'completed' || jobStatus === 'failed') {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(jobStatus).toBe('completed');
    const downloadUrl = getDemoJobDownloadUrl(jobId);
    expect(downloadUrl).toBe('blob:demo-test');
    expect(capturedBlob).not.toBeNull();

    const zip = await JSZip.loadAsync(await capturedBlob!.arrayBuffer());
    const fileNames = Object.keys(zip.files);
    expect(fileNames).toContain('demo_me.md');
    expect(fileNames).toContain('demo_me-summary.md');

    const emailMd = await zip.file('demo_me.md')!.async('string');
    expect(emailMd).toContain('[REDACTED_EMAIL]');
  });

  it('handles local-only stubs and AbortSignal cancellation cleanly', async () => {
    const ingestRes = await handleDemoFetch('/api/setup/ingest-status');
    expect(ingestRes.status).toBe(200);
    expect(await ingestRes.json()).toEqual({ isRunning: false });

    const resetRes = await handleDemoFetch('/api/system/reset-db', { method: 'POST' });
    expect(resetRes.status).toBe(501);

    const previewRes = await handleDemoFetch('/api/preview?url=https%3A%2F%2Fexample.com');
    expect(previewRes.status).toBe(404);

    const controller = new AbortController();
    controller.abort();
    await expect(handleDemoFetch('/api/status', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
