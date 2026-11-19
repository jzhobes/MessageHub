// @vitest-environment node
import '../helpers/remoteFetchMock';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/preview';

describe('/api/preview', () => {
  let originalWorkspace: string;
  let originalInstagramAuth: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    originalInstagramAuth = process.env.INSTAGRAM_AUTH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-preview-'));
    appConfig.WORKSPACE_PATH = tempDir;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    appConfig.WORKSPACE_PATH = originalWorkspace;
    if (originalInstagramAuth === undefined) {
      delete process.env.INSTAGRAM_AUTH;
    } else {
      process.env.INSTAGRAM_AUTH = originalInstagramAuth;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 400 when url is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Missing url' });
  });

  it('returns 400 when url is malformed', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { url: 'invalid-url' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Invalid URL' });
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://127.0.0.2/admin',
    'http://2130706433/admin',
    'http://[::ffff:127.0.0.1]/admin',
    'http://[fc00::1]/admin',
    'http://[::1]/admin',
    'http://nas.local/files',
    'http://metadata.internal/token',
    'http://10.0.0.1/status',
    'http://192.168.1.5/router',
    'http://172.16.0.1/metrics',
    'http://172.31.255.1/metrics',
    'http://169.254.169.254/latest/meta-data/',
  ])('blocks SSRF target without calling fetch: %s', async (targetUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['https://example.com/article', 'https://reddit.com/r/news/comments/abc'])(
    'blocks private redirects from either preview strategy: %s',
    async (url) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { req, res } = createMocks({ method: 'GET', query: { url } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(tempDir, 'preview_cache.json'))).toBe(false);
    },
  );

  it('strips Instagram credentials on cross-origin redirects', async () => {
    process.env.INSTAGRAM_AUTH = 'sessionid=fake-test-session';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.com/photo' } }))
      .mockResolvedValueOnce(new Response('<meta property="og:title" content="Photo" />'));
    vi.stubGlobal('fetch', fetchMock);
    const { req, res } = createMocks({ method: 'GET', query: { url: 'https://www.instagram.com/p/123/' } });
    await handler(req, res);
    expect(res._getJSONData().title).toBe('Photo');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('cookie')).toBe('sessionid=fake-test-session');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('cookie')).toBeNull();
  });

  it('does not send Instagram cookies over HTTP', async () => {
    process.env.INSTAGRAM_AUTH = 'sessionid=fake-test-session';
    const fetchMock = vi.fn().mockResolvedValue(new Response(''));
    vi.stubGlobal('fetch', fetchMock);
    const { req, res } = createMocks({ method: 'GET', query: { url: 'http://www.instagram.com/p/123/' } });
    await handler(req, res);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('cookie')).toBeNull();
  });

  it('returns cached preview without calling fetch on cache hit', async () => {
    const targetUrl = 'https://example.com/cached-article';
    const cachedEntry = {
      url: targetUrl,
      title: 'Cached Title',
      image: 'https://example.com/cached.png',
      description: 'Cached Description',
    };
    fs.writeFileSync(path.join(tempDir, 'preview_cache.json'), JSON.stringify({ [targetUrl]: cachedEntry }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual(cachedEntry);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses quoted and unquoted metadata attributes and decodes entities once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`
      <META CONTENT="It's > a test &amp;lt;b&amp;gt;" PROPERTY=og:title>
      <meta name=description content="A &quot;quoted&quot; description">
      <meta property=og:title content="Later duplicate">
    `),
      ),
    );
    const { req, res } = createMocks({ query: { url: 'https://example.com/parser' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      title: "It's > a test &lt;b&gt;",
      description: 'A "quoted" description',
    });
  });

  it('extracts OpenGraph/Twitter metadata, decodes HTML entities, and caches result', async () => {
    const targetUrl = 'https://example.com/article';
    const html = `
      <html>
        <head>
          <meta content="Hello &amp; Welcome" property="og:title" />
          <meta property="twitter:image" content="https://example.com/hero.jpg" />
          <meta name="description" content="It&#39;s a great &quot;day&quot;" />
        </head>
      </html>
    `;
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: [targetUrl] } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data).toEqual({
      url: targetUrl,
      title: 'Hello & Welcome',
      image: 'https://example.com/hero.jpg',
      description: 'It\'s a great "day"',
    });

    const writtenCache = JSON.parse(fs.readFileSync(path.join(tempDir, 'preview_cache.json'), 'utf8'));
    expect(writtenCache[targetUrl]).toEqual(data);
  });

  it('uses Reddit JSON strategy for array responses and filters non-http thumbnails', async () => {
    const targetUrl = 'https://www.reddit.com/r/typescript/comments/abc123/post_title/';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            data: {
              children: [
                {
                  data: {
                    title: 'TypeScript 5 Tips',
                    thumbnail: 'self',
                    selftext: 'Body text here',
                  },
                },
              ],
            },
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      url: targetUrl,
      title: 'TypeScript 5 Tips',
      image: null,
      description: 'Body text here',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.reddit.com/r/typescript/comments/abc123/post_title.json',
      expect.any(Object),
    );
  });

  it('uses Reddit JSON object responses and falls back to HTML when JSON lacks a title', async () => {
    const targetUrl = 'https://reddit.com/r/news/comments/xyz';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              children: [{ data: { thumbnail: 'https://b.thumbs.redditmedia.com/thumb.jpg' } }],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('<meta property="og:title" content="Fallback HTML Title" />', { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().title).toBe('Fallback HTML Title');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses Facebook crawler headers and rewrites lookaside image URLs to proxy', async () => {
    const targetUrl = 'https://www.facebook.com/share/p/12345';
    const lookasideUrl = 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=99';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `<meta property="og:title" content="FB Post" /><meta property="og:image" content="${lookasideUrl}" />`,
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      url: targetUrl,
      title: 'FB Post',
      image: `/api/fb-image-proxy?url=${encodeURIComponent(lookasideUrl)}`,
      description: null,
    });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('user-agent')).toContain('facebookexternalhit');
  });

  it('sends authenticated Instagram cookie headers when INSTAGRAM_AUTH is configured', async () => {
    process.env.INSTAGRAM_AUTH = JSON.stringify({ sessionid: 'sess123', csrftoken: 'csrf456' });
    const targetUrl = 'https://www.instagram.com/p/C12345/';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<meta property="og:title" content="IG Photo" />', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().title).toBe('IG Photo');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('cookie')).toBe('sessionid=sess123; csrftoken=csrf456');
  });

  it('degrades gracefully when upstream fails, times out, or hits redirect loop', async () => {
    const timeoutErr = new Error('Timed out');
    timeoutErr.name = 'TimeoutError';

    const redirectErr = Object.assign(new Error('fetch failed'), {
      cause: { message: 'redirect count exceeded' },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(redirectErr);
    vi.stubGlobal('fetch', fetchMock);

    for (const targetUrl of [
      'https://example.com/status-403',
      'https://example.com/timeout',
      'https://example.com/redirect-loop',
    ]) {
      const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getJSONData()).toEqual({
        url: targetUrl,
        title: null,
        image: null,
        description: null,
      });
    }
  });
});
