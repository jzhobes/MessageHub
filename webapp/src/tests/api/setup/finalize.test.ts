// @vitest-environment node
import { spawnSync } from 'child_process';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { getIngestScriptPath, getPythonPath } from '@/lib/server/python';
import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/setup/finalize';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('@/lib/server/python', () => ({
  getPythonPath: vi.fn(),
  getIngestScriptPath: vi.fn(),
}));

describe('/api/setup/finalize', () => {
  beforeEach(() => {
    vi.spyOn(db, 'close').mockImplementation(() => {});
    vi.mocked(getPythonPath).mockResolvedValue('/venv/bin/python');
    vi.mocked(getIngestScriptPath).mockReturnValue('/scripts/ingest.py');
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      pid: 123,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST']);
  });

  it('returns 400 when runtime WORKSPACE_PATH is empty', async () => {
    vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get').mockReturnValue('');

    const { req, res } = createMocks({ method: 'POST' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'No runtime WORKSPACE_PATH set. Complete setup first.' });
  });

  it('closes DB and skips Python init when DB already exists', async () => {
    vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get').mockReturnValue('/tmp/ws');
    vi.spyOn(db, 'exists').mockReturnValue(true);

    const { req, res } = createMocks({ method: 'POST' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ success: true, message: 'Workspace finalized successfully.' });
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('runs Python schema init when DB does not exist and handles spawnSync error cleanly', async () => {
    vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get').mockReturnValue('/tmp/ws-new');
    vi.spyOn(db, 'exists').mockReturnValue(false);

    const okCall = createMocks({ method: 'POST' });
    await handler(okCall.req, okCall.res);

    expect(okCall.res._getStatusCode()).toBe(200);
    expect(db.close).toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledWith(
      '/venv/bin/python',
      ['/scripts/ingest.py'],
      expect.objectContaining({
        env: expect.objectContaining({
          WORKSPACE_PATH: '/tmp/ws-new',
          PYTHONUNBUFFERED: '1',
        }),
      }),
    );

    vi.mocked(spawnSync).mockReturnValueOnce({
      status: null,
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
      error: new Error('ENOENT'),
    });

    const warnCall = createMocks({ method: 'POST' });
    await handler(warnCall.req, warnCall.res);

    expect(warnCall.res._getStatusCode()).toBe(200);
    expect(console.error).toHaveBeenCalledWith('Failed to run Python init:', expect.any(Error));
  });

  it('returns 500 when finalizing throws an error', async () => {
    vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get').mockReturnValue('/tmp/ws-err');
    vi.spyOn(db, 'exists').mockReturnValue(false);
    vi.mocked(getPythonPath).mockRejectedValueOnce(new Error('Python missing'));

    const { req, res } = createMocks({ method: 'POST' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Finalization failed: Python missing' });
  });
});
