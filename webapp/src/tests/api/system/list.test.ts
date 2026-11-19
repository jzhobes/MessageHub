// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fileSystem from '@/lib/server/fileSystem';
import { getMyNames } from '@/lib/server/identity';
import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/system/list';

vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn(),
}));

describe('/api/system/list', () => {
  let originalWorkspace: string;
  let tempRoot: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-syslist-')));
    appConfig.WORKSPACE_PATH = tempRoot;

    fs.mkdirSync(path.join(tempRoot, 'z-folder'));
    fs.mkdirSync(path.join(tempRoot, 'a-folder', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'archive.zip'), 'zip');
    fs.writeFileSync(path.join(tempRoot, 'readme.txt'), 'txt');
    fs.writeFileSync(path.join(tempRoot, '.hidden'), 'secret');

    vi.spyOn(fileSystem, 'getRoot').mockReturnValue(tempRoot);
    vi.mocked(getMyNames).mockResolvedValue(['Me', 'John Doe']);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    appConfig.WORKSPACE_PATH = originalWorkspace;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('lists root directory contents in import mode with folders first and hidden files omitted', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { mode: 'import' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.path).toBe(tempRoot);
    expect(data.parent).toBeNull();
    expect(data.meta).toBeNull();
    expect(data.items.map((i: { name: string; type: string }) => `${i.type}:${i.name}`)).toEqual([
      'folder:a-folder',
      'folder:z-folder',
      'file:archive.zip',
      'file:readme.txt',
    ]);
  });

  it('filters files by extensions and computes non-null parent for subdirectories', async () => {
    const subDir = path.join(tempRoot, 'a-folder');
    fs.writeFileSync(path.join(subDir, 'backup.zip'), 'zip');
    fs.writeFileSync(path.join(subDir, 'notes.md'), 'md');

    const { req, res } = createMocks({
      method: 'GET',
      query: { mode: 'import', path: subDir, extensions: 'zip,.txt' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.parent).toBe(tempRoot);
    expect(data.items.map((i: { name: string }) => i.name)).toEqual(['nested', 'backup.zip']);
  });

  it('returns 404 in import mode when directory does not exist', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { mode: 'import', path: path.join(tempRoot, 'missing') },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(res._getJSONData()).toEqual({ error: 'Path not found' });
  });

  it('returns workspace metadata and empty items for nonexistent path in workspace mode', async () => {
    const existingCall = createMocks({
      method: 'GET',
      query: { mode: 'workspace', path: tempRoot },
    });
    await handler(existingCall.req, existingCall.res);

    expect(existingCall.res._getStatusCode()).toBe(200);
    const existingData = existingCall.res._getJSONData();
    expect(existingData.meta).toMatchObject({
      exists: true,
      isWritable: true,
      isActive: true,
      isEmpty: false,
    });

    const missingCall = createMocks({
      method: 'GET',
      query: { mode: 'workspace', path: path.join(tempRoot, 'future-workspace') },
    });
    await handler(missingCall.req, missingCall.res);

    expect(missingCall.res._getStatusCode()).toBe(200);
    expect(missingCall.res._getJSONData()).toMatchObject({
      items: [],
      meta: { exists: false },
    });
  });

  it('returns 403 HAL message with first name or fallback when outside root boundary', async () => {
    const outsidePath = path.resolve(tempRoot, '..');

    const namedCall = createMocks({
      method: 'GET',
      query: { mode: 'import', path: outsidePath },
    });
    await handler(namedCall.req, namedCall.res);
    expect(namedCall.res._getStatusCode()).toBe(403);
    expect(namedCall.res._getJSONData()).toEqual({
      error: "Access denied: I'm sorry, John. I'm afraid I can't do that.",
    });

    vi.mocked(getMyNames).mockResolvedValue(['Me', '   ']);
    const anonCall = createMocks({
      method: 'GET',
      query: { mode: 'import', path: outsidePath },
    });
    await handler(anonCall.req, anonCall.res);
    expect(anonCall.res._getStatusCode()).toBe(403);
    expect(anonCall.res._getJSONData()).toEqual({
      error: "Access denied: I'm sorry. I'm afraid I can't do that.",
    });
  });

  it('rejects a directory symlink escaping the allowed root', async () => {
    const link = path.join(tempRoot, 'escape');
    fs.symlinkSync(path.dirname(tempRoot), link, 'dir');
    for (const mode of ['import', 'workspace']) {
      const { req, res } = createMocks({ method: 'GET', query: { mode, path: link } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(403);
    }
  });

  it.each([{ mode: 'unexpected' }, { path: ['one', 'two'] }, { extensions: ['zip', 'txt'] }])(
    'rejects malformed query parameters: %j',
    async (query) => {
      const { req, res } = createMocks({ method: 'GET', query });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(400);
    },
  );

  it('returns 500 when listing directory fails unexpectedly', async () => {
    vi.spyOn(fileSystem, 'listContents').mockRejectedValueOnce(new Error('Disk I/O failure'));

    const { req, res } = createMocks({ method: 'GET', query: { mode: 'import', path: tempRoot } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Disk I/O failure' });
  });
});
