// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '@/lib/server/db';
import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/system/reset-db';

describe('/api/system/reset-db', () => {
  let originalWorkspace: string;
  let tempDir: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-reset-'));
    appConfig.WORKSPACE_PATH = tempDir;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    appConfig.WORKSPACE_PATH = originalWorkspace;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 405 on non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST']);
  });

  it('returns 400 when confirmation token is invalid or missing', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: { confirm: 'WRONG' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ error: 'Invalid confirmation' });
  });

  it('deletes database artifacts and platform folders while preserving unrelated files', async () => {
    const dbFiles = ['messagehub.db', 'messagehub.db-shm', 'messagehub.db-wal', 'preview_cache.json'];
    for (const f of dbFiles) {
      fs.writeFileSync(path.join(tempDir, f), 'data');
    }
    const platformDirs = ['Facebook', 'Instagram', 'Voice', 'Google Chat', 'Mail', 'Takeout', '.processed'];
    for (const d of platformDirs) {
      const dirPath = path.join(tempDir, d);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, 'sample.txt'), 'content');
    }
    fs.writeFileSync(path.join(tempDir, 'keep-me.txt'), 'safe');

    const closeSpy = vi.spyOn(db, 'close').mockImplementation(() => {});

    const { req, res } = createMocks({
      method: 'POST',
      body: { confirm: 'RESET' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      success: true,
      message: 'Workspace data successfully reset.',
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);

    for (const f of dbFiles) {
      expect(fs.existsSync(path.join(tempDir, f))).toBe(false);
    }
    for (const d of platformDirs) {
      expect(fs.existsSync(path.join(tempDir, d))).toBe(false);
    }
    expect(fs.existsSync(path.join(tempDir, 'keep-me.txt'))).toBe(true);
  });

  it('succeeds cleanly when database file does not exist', async () => {
    const closeSpy = vi.spyOn(db, 'close').mockImplementation(() => {});
    fs.mkdirSync(path.join(tempDir, 'Facebook'));

    const { req, res } = createMocks({
      method: 'POST',
      body: { confirm: 'RESET' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, 'Facebook'))).toBe(false);
  });

  it('returns 500 when an unexpected error occurs', async () => {
    vi.spyOn(db, 'exists').mockImplementation(() => {
      throw new Error('Unexpected disk failure');
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { confirm: 'RESET' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Failed to reset database: Unexpected disk failure' });
  });
});
