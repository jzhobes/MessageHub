import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import handler from '@/pages/api/content';

import { createMemoryDb, seedMessage, seedThread } from '../helpers/testDb';

import type Database from 'better-sqlite3';

// Using Real DB with data from samples
vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn().mockResolvedValue(['Me', 'John Doe']),
}));

describe('/api/content (Integration)', () => {
  it('should split Text+Media into two bubbles', async () => {
    // We added a "Text + Photo" message to 'simulation_theory_888' in the sample build.
    // Content: "Look at this glich in the matrix I found!"
    // Photos: 1

    const { req, res } = createMocks({
      method: 'GET',
      query: { threadId: 'simulation_theory_888' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();

    // Find our specific message by content or ID pattern
    const textPart = records.find(
      (m: { content?: string }) => m.content === 'Look at this glich in the matrix I found!',
    );
    expect(textPart).toBeDefined();

    // The text part should NOT have photos
    expect(textPart.photos).toBeUndefined();

    // There should be a corresponding media part (same timestamp)
    const mediaPart = records.find(
      (m: { timestamp_ms?: number; id?: string }) =>
        m.timestamp_ms === textPart.timestamp_ms && m.id?.endsWith('_media'),
    );

    expect(mediaPart).toBeDefined();
    expect(mediaPart.photos).toBeDefined();
    expect(mediaPart.photos.length).toBe(1);
  });

  it('should preserve Link Previews (Text + URL + 1 Photo)', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { threadId: 'simulation_theory_888' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();

    expect(records.length).toBeGreaterThan(0);
    const linkPreviewMsg = records.find((m: { content?: string }) => m.content?.includes('matrix.org/glitch'));
    expect(linkPreviewMsg).toBeDefined();

    expect(linkPreviewMsg.content).toBeDefined();
    expect(linkPreviewMsg.photos).toBeDefined();
    expect(linkPreviewMsg.photos.length).toBe(1);
  });
});

describe('/api/content (Unit)', () => {
  let memDb: Database.Database | null = null;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (memDb) {
      memDb.close();
      memDb = null;
    }
  });

  it('returns 400 when threadId is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Missing threadId' });
  });

  it('returns empty array when DB does not exist', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const { req, res } = createMocks({ method: 'GET', query: { threadId: 't1' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual([]);
  });

  it('paginates messages in descending timestamp order', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 't1', platform: 'facebook', title: 'Paginated' });
    for (let i = 1; i <= 105; i++) {
      seedMessage(memDb, {
        thread_id: 't1',
        sender_name: 'Alice',
        timestamp_ms: i * 1000,
        content: `msg-${i}`,
      });
    }

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const page1 = createMocks({ method: 'GET', query: { threadId: 't1', page: '1' } });
    await handler(page1.req, page1.res);
    expect(page1.res._getStatusCode()).toBe(200);
    expect(page1.res._getJSONData().records).toHaveLength(100);
    expect(page1.res._getJSONData().records[0].content).toBe('msg-105');

    const page2 = createMocks({ method: 'GET', query: { threadId: 't1', page: '2' } });
    await handler(page2.req, page2.res);
    expect(page2.res._getJSONData().records).toHaveLength(5);
    expect(page2.res._getJSONData().records[4].content).toBe('msg-1');
  });

  it('handles virtual posts, checkins, events, and fb_event_ grouping', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'p1', platform: 'facebook', title: 'Untitled Post', labels: ['post'] });
    seedThread(memDb, { id: 'p2', platform: 'facebook', title: 'Fallback Post Title', labels: ['post'] });
    seedThread(memDb, { id: 'c1', platform: 'facebook', title: 'Coffee Shop', labels: ['checkin'] });
    seedThread(memDb, { id: 'fb_event_1', platform: 'facebook', title: 'Launch Party', labels: ['event'] });

    seedMessage(memDb, { thread_id: 'p1', sender_name: 'John Doe', timestamp_ms: 1000, content: 'Real post text' });
    seedMessage(memDb, { thread_id: 'p2', sender_name: 'John Doe', timestamp_ms: 2000, content: '' });
    seedMessage(memDb, { thread_id: 'c1', sender_name: 'John Doe', timestamp_ms: 3000, content: 'Great latte' });
    seedMessage(memDb, {
      thread_id: 'fb_event_1',
      sender_name: 'John Doe',
      timestamp_ms: 4000,
      content: 'Created Event',
      share_json: JSON.stringify({ location: 'NYC', description: 'Bring snacks' }),
    });
    // Duplicate timestamp row for fb_event_1 should collapse under GROUP BY timestamp_ms
    seedMessage(memDb, {
      thread_id: 'fb_event_1',
      sender_name: 'Alice',
      timestamp_ms: 4000,
      content: 'Joined Event',
    });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const postsCall = createMocks({ method: 'GET', query: { threadId: 'fb-post-all' } });
    await handler(postsCall.req, postsCall.res);
    const postRecords = postsCall.res._getJSONData().records;
    expect(postRecords.map((r: { content: string }) => r.content)).toEqual(['Fallback Post Title', 'Real post text']);

    const checkinsCall = createMocks({ method: 'GET', query: { threadId: 'fb-checkin-all' } });
    await handler(checkinsCall.req, checkinsCall.res);
    expect(checkinsCall.res._getJSONData().records[0].content).toBe('Great latte');

    const eventsCall = createMocks({ method: 'GET', query: { threadId: 'fb-event-owned' } });
    await handler(eventsCall.req, eventsCall.res);
    expect(eventsCall.res._getJSONData().records).toHaveLength(1);
    expect(eventsCall.res._getJSONData().records[0]).toMatchObject({
      content: 'Launch Party',
      event_metadata: { location: 'NYC', description: 'Bring snacks' },
    });

    const singleEventCall = createMocks({ method: 'GET', query: { threadId: 'fb_event_1' } });
    await handler(singleEventCall.req, singleEventCall.res);
    expect(singleEventCall.res._getJSONData().records).toHaveLength(1);
  });

  it('promotes file attachments, parses annotations, quoted messages, reactions, stickers, and gifs', async () => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'rich_1', platform: 'google_chat', title: 'Rich' });

    seedMessage(memDb, {
      thread_id: 'rich_1',
      sender_name: 'Me',
      timestamp_ms: 3000,
      content: 'Check attachments',
      media_json: JSON.stringify([
        { type: 'file', uri: 'photo.png' },
        { type: 'file', uri: 'clip.mp4' },
        { type: 'file', uri: 'sheet.pdf' },
        { type: 'gif', uri: 'dance.gif' },
        { type: 'sticker', uri: 'wave.webp' },
      ]),
      annotations_json: JSON.stringify([{ url_metadata: { image_url: 'https://img.example/preview.jpg' } }]),
      reactions_json: JSON.stringify([{ reaction: '👍', actor: 'Alice' }]),
      share_json: JSON.stringify({
        quoted_message: { creator: 'Alice', text: 'Original prompt' },
      }),
    });

    seedMessage(memDb, {
      thread_id: 'rich_1',
      sender_name: 'Alice',
      timestamp_ms: 2000,
      content: '',
      share_json: JSON.stringify({
        quoted_message: { creator: { name: 'Bob' }, text: 'Nested creator' },
      }),
    });

    seedMessage(memDb, {
      thread_id: 'rich_1',
      sender_name: 'Alice',
      timestamp_ms: 1000,
      content: 'Shared link',
      share_json: JSON.stringify({ link: 'https://example.com', share_text: 'Read this' }),
    });

    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);

    const { req, res } = createMocks({ method: 'GET', query: { threadId: ['rich_1'] } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();
    // Row 1 splits into media + text bubbles (2 records); row 2 & 3 are 1 each -> 4 total
    expect(records).toHaveLength(4);

    expect(records[0]).toMatchObject({
      is_sender: true,
      photos: [{ uri: 'photo.png', type: 'file' }, { uri: 'https://img.example/preview.jpg' }],
      videos: [{ uri: 'clip.mp4', type: 'file' }],
      gifs: [{ uri: 'dance.gif', type: 'gif' }],
      sticker: { uri: 'wave.webp', type: 'sticker' },
      reactions: [{ reaction: '👍', actor: 'Alice' }],
    });

    expect(records[1]).toMatchObject({
      content: 'Check attachments',
      attachments: [{ uri: 'sheet.pdf', type: 'file' }],
      quoted_message_metadata: { creator: { name: 'Alice' }, text: 'Original prompt' },
    });

    expect(records[2]).toMatchObject({
      is_sender: false,
      quoted_message_metadata: { creator: { name: 'Bob' }, text: 'Nested creator' },
    });

    expect(records[3].share).toEqual({ link: 'https://example.com', share_text: 'Read this' });
  });

  it('returns 500 when querying messages fails', async () => {
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockImplementation(() => {
      throw new Error('DB read error');
    });

    const { req, res } = createMocks({ method: 'GET', query: { threadId: 't1' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Failed to load messages' });
  });
});
