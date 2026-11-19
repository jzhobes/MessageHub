// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import { persistWorkspacePath } from '@/lib/server/env';
import fileSystem from '@/lib/server/fileSystem';
import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/setup/config';

vi.mock('@/lib/server/env', () => ({
  persistWorkspacePath: vi.fn(),
}));

describe('/api/setup/config', () => {
  let originalWorkspace: string;
  let tempRoot: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-config-'));
    appConfig.WORKSPACE_PATH = tempRoot;

    vi.spyOn(fileSystem, 'getRoot').mockReturnValue(tempRoot);
    vi.spyOn(db, 'close').mockImplementation(() => {});
    vi.mocked(persistWorkspacePath).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    appConfig.WORKSPACE_PATH = originalWorkspace;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns 405 for unsupported methods', async () => {
    const { req, res } = createMocks({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['GET', 'POST']);
  });

  it('GET returns current workspace path and existence status', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      workspacePath: tempRoot,
      exists: true,
      resolved: tempRoot,
    });

    const missingPath = path.join(tempRoot, 'not-created-yet');
    process.env.WORKSPACE_PATH = missingPath;
    const missingCall = createMocks({ method: 'GET' });
    await handler(missingCall.req, missingCall.res);

    expect(missingCall.res._getStatusCode()).toBe(200);
    expect(missingCall.res._getJSONData()).toEqual({
      workspacePath: missingPath,
      exists: false,
      resolved: missingPath,
    });
  });

  it('GET returns 403 when current workspace path is outside allowed boundary', async () => {
    process.env.WORKSPACE_PATH = path.resolve(tempRoot, '..');
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(res._getJSONData()).toEqual({ error: 'Current workspace path is outside allowed boundaries' });
  });

  it('POST returns 400 for missing or invalid workspacePath', async () => {
    const { req, res } = createMocks({ method: 'POST', body: { workspacePath: 123 } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Invalid path' });
  });

  it('POST returns 403 when path is outside allowed boundary, nested, or read-only', async () => {
    const outsideCall = createMocks({
      method: 'POST',
      body: { workspacePath: path.resolve(tempRoot, '..') },
    });
    await handler(outsideCall.req, outsideCall.res);
    expect(outsideCall.res._getStatusCode()).toBe(403);

    const nestedDir = path.join(tempRoot, 'nested');
    fs.mkdirSync(nestedDir);
    const nestedCall = createMocks({
      method: 'POST',
      body: { workspacePath: nestedDir },
    });
    await handler(nestedCall.req, nestedCall.res);
    expect(nestedCall.res._getStatusCode()).toBe(403);
    expect(nestedCall.res._getJSONData()).toEqual({ error: 'This location is inside another workspace.' });

    const readonlyDir = path.join(tempRoot, 'readonly');
    vi.spyOn(fileSystem, 'getPathMetadata').mockResolvedValueOnce({
      exists: true,
      isWritable: false,
      isEmpty: true,
      isNested: false,
      isActive: false,
      isExistingWorkspace: false,
    });
    const readonlyCall = createMocks({
      method: 'POST',
      body: { workspacePath: readonlyDir },
    });
    await handler(readonlyCall.req, readonlyCall.res);
    expect(readonlyCall.res._getStatusCode()).toBe(403);
    expect(readonlyCall.res._getJSONData()).toEqual({ error: 'Permission denied: Cannot write to this folder.' });
  });

  it('POST skips creation and config update when create is false for nonexistent path', async () => {
    const newDir = path.join(tempRoot, 'uncreated');
    const { req, res } = createMocks({
      method: 'POST',
      body: { workspacePath: newDir, create: false },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      workspacePath: newDir,
      exists: false,
      resolved: newDir,
    });
    expect(fs.existsSync(newDir)).toBe(false);
    expect(db.close).not.toHaveBeenCalled();
    expect(persistWorkspacePath).not.toHaveBeenCalled();
  });

  it('POST creates directory when create=true, updates appConfig, closes DB, and persists .env', async () => {
    const newDir = path.join(tempRoot, 'new-workspace');
    const { req, res } = createMocks({
      method: 'POST',
      body: { workspacePath: newDir, create: true },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      workspacePath: newDir,
      exists: true,
      resolved: newDir,
      isEmpty: true,
      isExistingWorkspace: false,
    });
    expect(fs.existsSync(newDir)).toBe(true);
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(appConfig.WORKSPACE_PATH).toBe(newDir);
    expect(persistWorkspacePath).toHaveBeenCalledWith(newDir);
  });

  it('POST returns 500 when mkdir fails and still returns 200 if persistWorkspacePath fails', async () => {
    const failDir = path.join(tempRoot, 'fail-mkdir');
    vi.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(new Error('EACCES'));

    const failCall = createMocks({
      method: 'POST',
      body: { workspacePath: failDir, create: true },
    });
    await handler(failCall.req, failCall.res);

    expect(failCall.res._getStatusCode()).toBe(500);
    expect(failCall.res._getJSONData().error).toContain('Failed to create folder: EACCES');

    const okDir = path.join(tempRoot, 'env-fail-ok');
    vi.mocked(persistWorkspacePath).mockRejectedValueOnce(new Error('Read-only .env'));

    const okCall = createMocks({
      method: 'POST',
      body: { workspacePath: okDir, create: true },
    });
    await handler(okCall.req, okCall.res);

    expect(okCall.res._getStatusCode()).toBe(200);
    expect(okCall.res._getJSONData().exists).toBe(true);
  });
});
