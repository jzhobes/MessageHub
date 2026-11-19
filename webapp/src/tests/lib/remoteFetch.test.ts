// @vitest-environment node
import '../helpers/remoteFetchMock';

import dns from 'node:dns';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchRemote } from '@/lib/server/remoteFetch';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchRemote', () => {
  it('preserves binary bytes exactly at the limit', async () => {
    const bytes = Buffer.from([0, 255, 128, 1]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)));
    const { readBody } = await fetchRemote('https://example.com/image', { maxResponseBytes: 4 });
    expect(await readBody()).toEqual(bytes);
  });

  it('cancels a streamed body when it exceeds the byte limit', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const { readBody } = await fetchRemote('https://example.com/image', { maxResponseBytes: 4 });
    await expect(readBody()).rejects.toMatchObject({ code: 'response_too_large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('uses the remaining fetch budget for a stalled body and cancels it', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(new ReadableStream({ cancel }));
      }),
    );
    const pending = fetchRemote('https://example.com/slow', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(30);
    const { readBody } = await pending;
    const assertion = expect(readBody()).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects body reading after the deadline even if bytes are already available', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ready')));
    const { readBody } = await fetchRemote('https://example.com/', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(51);
    await expect(readBody()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects mixed public and private DNS answers without fetching', async () => {
    vi.mocked(dns.promises.Resolver.prototype.resolve4).mockResolvedValue(['93.184.216.34', '10.0.0.1'] as never);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(fetchRemote('https://example.com/')).rejects.toMatchObject({ code: 'hostname_unsafe' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
