// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestionManager } from '@/lib/server/ingestionManager';
import handler from '@/pages/api/setup/ingest-status';

describe('/api/setup/ingest-status', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns current ingestionManager state', () => {
    const mockState = {
      isRunning: true,
      isComplete: false,
      exitCode: null,
      logs: [{ type: 'stdout', payload: 'Processing...' }],
    };
    vi.spyOn(ingestionManager, 'getState').mockReturnValue(mockState);

    const { req, res } = createMocks({ method: 'GET' });
    handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual(mockState);
  });
});
