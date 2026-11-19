import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkInstagram, INSTAGRAM_AUTH_CHECK_URL } from '@/lib/server/startup';

describe('checkInstagram', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns valid for 200 non-login response with JSON INSTAGRAM_AUTH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><head><title>Edit Profile • Instagram</title></head></html>', {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram(JSON.stringify({ sessionid: 'abc', csrftoken: 'xyz' }));

    expect(result).toBe('valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(INSTAGRAM_AUTH_CHECK_URL);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).Cookie).toBe('sessionid=abc; csrftoken=xyz');
    expect(logSpy).toHaveBeenCalledWith('✅ [Instrumentation] Instagram Credentials appear VALID.');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('passes raw cookie string through and returns valid for 200 non-login response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><head><title>Edit Profile • Instagram</title></head></html>', {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rawCookie = 'sessionid=raw123; csrftoken=csrf456';
    const result = await checkInstagram(rawCookie);

    expect(result).toBe('valid');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Cookie).toBe(rawCookie);
    expect(logSpy).toHaveBeenCalledWith('✅ [Instrumentation] Instagram Credentials appear VALID.');
  });

  it('returns invalid when 200 response returns a login page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html><head><title>Login • Instagram</title></head></html>', {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram('sessionid=abc');

    expect(result).toBe('invalid');
    expect(warnSpy).toHaveBeenCalledWith(
      '⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Login page returned).',
    );
  });

  it('returns invalid for 302 redirect to root (invalid sessionid behavior)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://www.instagram.com/' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram('sessionid=invalid');

    expect(result).toBe('invalid');
    expect(warnSpy).toHaveBeenCalledWith(
      '⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Status: 302, Redirect: /).',
    );
  });

  it('returns invalid and strips query string for 302 redirect to login (missing sessionid behavior)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location:
            'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Faccounts%2Fedit%2F',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram('foo=bar');

    expect(result).toBe('invalid');
    expect(warnSpy).toHaveBeenCalledWith(
      '⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Status: 302, Redirect: /accounts/login/).',
    );
    expect(warnSpy.mock.calls[0][0]).not.toContain('?next=');
  });

  it.each(['https://www.instagram.com/challenge/action/123/', 'https://www.instagram.com/checkpoint/'])(
    'returns checkpoint for 302 redirect to %s',
    async (location) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await checkInstagram('sessionid=abc');

      expect(result).toBe('checkpoint');
      const expectedPath = new URL(location).pathname;
      expect(warnSpy).toHaveBeenCalledWith(
        `⚠️  [Instrumentation] Instagram session requires verification/checkpoint (Status: 302, Redirect: ${expectedPath}).`,
      );
    },
  );

  it.each([401, 403])('returns invalid for HTTP %i', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram('sessionid=abc');

    expect(result).toBe('invalid');
    expect(warnSpy).toHaveBeenCalledWith(
      `⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Status: ${status}).`,
    );
  });

  it.each([429, 503])('returns inconclusive for HTTP %i', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram('sessionid=abc');

    expect(result).toBe('inconclusive');
    expect(warnSpy).toHaveBeenCalledWith(
      `⚠️  [Instrumentation] Instagram credential check inconclusive (Status: ${status} — rate-limited or unavailable).`,
    );
    expect(warnSpy.mock.calls[0][0]).not.toContain('INVALID or EXPIRED');
  });

  it('returns error when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkInstagram('sessionid=abc');

    expect(result).toBe('error');
    expect(warnSpy).toHaveBeenCalledWith(
      '⚠️  [Instrumentation] Failed to connect to Instagram check: The operation was aborted due to timeout',
    );
  });
});
