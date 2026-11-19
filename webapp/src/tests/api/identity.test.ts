// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyNames } from '@/lib/server/identity';
import handler from '@/pages/api/identity';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/identity', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with identity names', async () => {
    vi.mocked(getMyNames).mockResolvedValue(['Me', 'John Doe']);

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ names: ['Me', 'John Doe'] });
  });

  it('returns 500 when getMyNames throws', async () => {
    vi.mocked(getMyNames).mockRejectedValue(new Error('DB failure'));

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error' });
  });
});
