import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import handler from '@/pages/api/content';

import { createMemoryDb, seedMessage, seedThread } from '../helpers/testDb';

import type Database from 'better-sqlite3';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn().mockResolvedValue(['Me', 'John Doe']),
}));

describe('/api/content (Integration)', () => {
  const photo = { type: 'photo', uri: 'photo.jpg' };
  let memDb: Database.Database;

  beforeEach(() => {
    memDb = createMemoryDb();
    seedThread(memDb, { id: 'photos', platform: 'facebook', labels: ['message'] });
    vi.spyOn(db, 'exists').mockReturnValue(true);
    vi.spyOn(db, 'get').mockReturnValue(memDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    memDb.close();
  });

  it('splits text and a photo into two bubbles', async () => {
    const content = 'Look at this sunset!';
    const messageId = seedMessage(memDb, {
      thread_id: 'photos',
      sender_name: 'Alice',
      timestamp_ms: 1000,
      content,
      media_json: JSON.stringify([photo]),
    });

    const { req, res } = createMocks({
      method: 'GET',
      query: { threadId: 'photos' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();

    expect(records).toHaveLength(2);
    const textPart = records.find((record: { id: string }) => record.id === String(messageId));
    expect(textPart).toMatchObject({ content, timestamp_ms: 1000 });
    expect(textPart).not.toHaveProperty('photos');
    const mediaPart = records.find((record: { id: string }) => record.id === `${messageId}_media`);
    expect(mediaPart).toMatchObject({ photos: [photo], timestamp_ms: 1000 });
    expect(mediaPart).not.toHaveProperty('content');
  });

  it('keeps a voice reply together with its quote and reaction', async () => {
    const audio = { type: 'audio', uri: 'voice.ogg' };
    const reactions = [{ reaction: '😆', actor: 'Alice' }];
    const messageId = seedMessage(memDb, {
      thread_id: 'photos',
      sender_name: 'Me',
      timestamp_ms: 1000,
      content: '',
      media_json: JSON.stringify([audio]),
      share_json: JSON.stringify({ quoted_message: { creator: 'Alice', text: 'Original message' } }),
      reactions_json: JSON.stringify(reactions),
    });

    const { req, res } = createMocks({ method: 'GET', query: { threadId: 'photos' } });
    await handler(req, res);

    expect(res._getJSONData().records).toMatchObject([
      {
        id: String(messageId),
        audio: [audio],
        quoted_message_metadata: { creator: { name: 'Alice' }, text: 'Original message' },
        reactions,
      },
    ]);
  });

  it('keeps text, a URL, and one photo together for link previews', async () => {
    const content = 'Here is the trail map https://example.com/trail';
    const messageId = seedMessage(memDb, {
      thread_id: 'photos',
      sender_name: 'Alice',
      timestamp_ms: 1000,
      content,
      media_json: JSON.stringify([photo]),
    });
    const { req, res } = createMocks({
      method: 'GET',
      query: { threadId: 'photos' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: String(messageId), content, photos: [photo] });
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
    // The fb_event_1 duplicate should collapse because it shares a timestamp.
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
    // The first row becomes two bubbles. The other two stay as one each, for four total.
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
