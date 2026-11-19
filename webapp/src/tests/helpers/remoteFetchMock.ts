import dns from 'node:dns';

import { beforeEach, vi } from 'vitest';

// Exercise the real URL/redirect policy while replacing only DNS and the HTTP transport.
vi.mock('guarded-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('guarded-fetch')>();
  return {
    ...actual,
    guardedFetch: (url: string, options: import('guarded-fetch').GuardedFetchOptions) =>
      actual.guardedFetch(url, { ...options, fetch: globalThis.fetch }),
  };
});

beforeEach(() => {
  vi.spyOn(dns.promises.Resolver.prototype, 'resolve4').mockResolvedValue(['93.184.216.34'] as never);
  vi.spyOn(dns.promises.Resolver.prototype, 'resolve6').mockResolvedValue([] as never);
});
