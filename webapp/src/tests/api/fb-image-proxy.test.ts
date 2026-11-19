// @vitest-environment node
import '../helpers/remoteFetchMock';

import { format } from 'node:util';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '@/pages/api/fb-image-proxy';

describe('/api/fb-image-proxy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns 400 when url query param is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Missing url' });
  });

  it('returns 400 when url is invalid', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { url: 'not-a-valid-url' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Invalid URL' });
  });

  it.each(['%s', '%d', '%j', '%o'])(
    'logs invalid URLs containing %s without consuming the error',
    async (specifier) => {
      const url = `invalid-url-${specifier}`;
      const { req, res } = createMocks({ method: 'GET', query: { url } });

      await handler(req, res);

      const args = vi.mocked(console.error).mock.calls[0];
      expect(res._getStatusCode()).toBe(400);
      expect(format(...args)).toContain(`Invalid URL: "${url}"`);
      expect(args[args.length - 1]).toBeInstanceOf(Error);
      expect(format(...args)).toContain('TypeError');
    },
  );

  it.each([
    'https://example.com/photo.jpg',
    'https://evilfacebook.com/photo.jpg',
    'https://facebook.com.evil.com/photo.jpg',
  ])('returns 403 for disallowed domain: %s', async (targetUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(res._getJSONData()).toEqual({ error: 'Domain not allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://facebook.com/img.jpg',
    'https://scontent.xx.fbcdn.net/v/t1.0-9/img.png',
    'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=123',
    'https://m.fb.com/pic.webp',
  ])('proxies allowed domain with crawler headers: %s', async (targetUrl) => {
    const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(imgBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({ method: 'GET', query: { url: targetUrl } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getHeaders()['content-type']).toBe('image/png');
    expect(res._getHeaders()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(res._getData())).toEqual(imgBytes);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('user-agent')).toContain('facebookexternalhit');
  });

  it.each(['https://example.com/image.jpg', 'http://127.0.0.1/admin'])(
    'rejects redirects outside the CDN allowlist: %s',
    async (location) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
      vi.stubGlobal('fetch', fetchMock);
      const { req, res } = createMocks({ method: 'GET', query: { url: 'https://lookaside.fbsbx.com/image' } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('follows redirects between allowed CDN hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://scontent.xx.fbcdn.net/image' } }),
      )
      .mockResolvedValueOnce(new Response(Buffer.from([0, 255]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { req, res } = createMocks({ method: 'GET', query: { url: 'https://lookaside.fbsbx.com/image' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(Buffer.from(res._getData())).toEqual(Buffer.from([0, 255]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the first element when url query param is an array', async () => {
    const imgBytes = Buffer.from('jpeg-data');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(imgBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createMocks({
      method: 'GET',
      query: { url: ['https://scontent.fbcdn.net/first.jpg', 'https://scontent.fbcdn.net/second.jpg'] },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://scontent.fbcdn.net/first.jpg', expect.any(Object));
  });

  it('forwards upstream non-OK status codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));

    const { req, res } = createMocks({
      method: 'GET',
      query: { url: 'https://scontent.fbcdn.net/missing.jpg' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(res._getData()).toBe('Failed to fetch image');
  });

  it('returns 415 when upstream content-type is missing or not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>login</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const { req, res } = createMocks({
      method: 'GET',
      query: { url: 'https://facebook.com/login' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(415);
    expect(res._getData()).toBe('Unsupported Media Type: Proxy only allows images');
  });

  it('returns 500 when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    const { req, res } = createMocks({
      method: 'GET',
      query: { url: 'https://scontent.fbcdn.net/img.jpg' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getData()).toBe('Internal Server Error');
  });
});
