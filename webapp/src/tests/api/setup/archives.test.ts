// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/setup/archives';

describe('/api/setup/archives', () => {
  let originalWorkspace: string;
  let tempDir: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-archives-'));
    appConfig.WORKSPACE_PATH = tempDir;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    appConfig.WORKSPACE_PATH = originalWorkspace;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['GET']);
  });

  it('returns only visible .zip, .tgz, and .tar.gz archives in workspace', async () => {
    fs.writeFileSync(path.join(tempDir, 'facebook.zip'), 'a');
    fs.writeFileSync(path.join(tempDir, 'takeout.tgz'), 'b');
    fs.writeFileSync(path.join(tempDir, 'archive.tar.gz'), 'c');
    fs.writeFileSync(path.join(tempDir, '.hidden.zip'), 'd');
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'e');
    fs.mkdirSync(path.join(tempDir, 'extracted-folder'));

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();
    expect(data.archives.sort()).toEqual(['archive.tar.gz', 'facebook.zip', 'takeout.tgz']);
  });

  it('returns empty archives array when workspace directory does not exist', async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ archives: [] });
  });
});
