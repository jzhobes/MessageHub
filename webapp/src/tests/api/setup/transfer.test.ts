// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fileSystem from '@/lib/server/fileSystem';
import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/setup/transfer';

import { createStreamingMocks, parseSSEEvents } from '../../helpers/httpHelpers';

describe('/api/setup/transfer', () => {
  let originalWorkspace: string;
  let tempBase: string;
  let importDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-transfer-'));
    importDir = path.join(tempBase, 'import');
    workspaceDir = path.join(tempBase, 'workspace');
    fs.mkdirSync(importDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    appConfig.WORKSPACE_PATH = workspaceDir;
    vi.spyOn(fileSystem, 'getRoot').mockImplementation((mode) => (mode === 'workspace' ? workspaceDir : importDir));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    appConfig.WORKSPACE_PATH = originalWorkspace;
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST']);
  });

  it('returns 400 when files array is missing or empty', async () => {
    const missing = createMocks({ method: 'POST', body: {} });
    await handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(400);

    const empty = createMocks({ method: 'POST', body: { files: [] } });
    await handler(empty.req, empty.res);
    expect(empty.res._getStatusCode()).toBe(400);
  });

  it('emits SSE error when workspace path is outside allowed boundaries', async () => {
    const outsideDir = path.join(tempBase, 'outside-workspace');
    fs.mkdirSync(outsideDir);
    appConfig.WORKSPACE_PATH = outsideDir;

    const { req, res } = createStreamingMocks({
      method: 'POST',
      body: { files: [path.join(importDir, 'a.zip')] },
    });

    await handler(req, res);

    expect(res._isEndCalled()).toBe(true);
    const events = parseSSEEvents(res._getData());
    expect(events).toEqual([
      { type: 'error', payload: 'PERMISSION_DENIED: Workspace target is outside allowed boundaries.' },
    ]);
  });

  it('creates missing workspace dir, copies valid files, skips existing and jailed files, and reports missing sources', async () => {
    const nestedWorkspace = path.join(workspaceDir, 'fresh-target');
    appConfig.WORKSPACE_PATH = nestedWorkspace;

    const validSource = path.join(importDir, 'facebook.zip');
    const existingSource = path.join(importDir, 'already.zip');
    const outsideSource = path.join(tempBase, 'outside.zip');
    const missingSource = path.join(importDir, 'missing.zip');

    fs.writeFileSync(validSource, 'new-zip-bytes');
    fs.writeFileSync(existingSource, 'new-version');
    fs.writeFileSync(outsideSource, 'secret');

    // Pre-create nestedWorkspace? Leave uncreated to verify auto-creation, OR wait:
    // if we want to test 'already exists', pre-create existingSource at dest after testing missing workspace,
    // or test auto-creation in one call and skip-existing in another!
    const createAndCopyCall = createStreamingMocks({
      method: 'POST',
      body: {
        files: [validSource, outsideSource, missingSource],
        operation: 'copy',
      },
    });
    await handler(createAndCopyCall.req, createAndCopyCall.res);

    expect(fs.existsSync(path.join(nestedWorkspace, 'facebook.zip'))).toBe(true);
    expect(fs.existsSync(validSource)).toBe(true);
    expect(fs.existsSync(path.join(nestedWorkspace, 'outside.zip'))).toBe(false);

    const events1 = parseSSEEvents(createAndCopyCall.res._getData());
    expect(events1).toEqual([
      { type: 'log', payload: `Creating target directory: ${nestedWorkspace}` },
      { type: 'log', payload: `Starting copy of 3 files to ${nestedWorkspace}` },
      { type: 'progress', payload: { index: 1, total: 3, file: 'facebook.zip', status: 'success' } },
      { type: 'log', payload: `Skipping ${outsideSource}: Access Denied (outside import root)` },
      {
        type: 'progress',
        payload: {
          index: 3,
          total: 3,
          file: 'missing.zip',
          status: 'error',
          error: `Source file does not exist: ${missingSource}`,
        },
      },
      { type: 'done', payload: { success: true } },
    ]);

    // Now test skipping already-existing destination without overwriting
    fs.writeFileSync(path.join(nestedWorkspace, 'already.zip'), 'original-dest');
    const skipExistingCall = createStreamingMocks({
      method: 'POST',
      body: { files: [existingSource], operation: 'copy' },
    });
    await handler(skipExistingCall.req, skipExistingCall.res);

    expect(fs.readFileSync(path.join(nestedWorkspace, 'already.zip'), 'utf8')).toBe('original-dest');
    const events2 = parseSSEEvents(skipExistingCall.res._getData());
    expect(events2).toContainEqual({
      type: 'log',
      payload: 'Skipping already.zip: File already exists in workspace.',
    });
    expect(events2).toContainEqual({
      type: 'progress',
      payload: { index: 1, total: 1, file: 'already.zip', status: 'success' },
    });
  });

  it('moves files directly and falls back to copy+unlink on EXDEV', async () => {
    const directSrc = path.join(importDir, 'direct.zip');
    const exdevSrc = path.join(importDir, 'cross-device.zip');
    fs.writeFileSync(directSrc, 'direct-data');
    fs.writeFileSync(exdevSrc, 'exdev-data');

    const origRename = fs.promises.rename.bind(fs.promises);
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (String(oldPath) === exdevSrc) {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      return origRename(oldPath, newPath);
    });

    const { req, res } = createStreamingMocks({
      method: 'POST',
      body: { files: [directSrc, exdevSrc], operation: 'move' },
    });

    await handler(req, res);

    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(directSrc)).toBe(false);
    expect(fs.existsSync(exdevSrc)).toBe(false);
    expect(fs.readFileSync(path.join(workspaceDir, 'direct.zip'), 'utf8')).toBe('direct-data');
    expect(fs.readFileSync(path.join(workspaceDir, 'cross-device.zip'), 'utf8')).toBe('exdev-data');

    const events = parseSSEEvents(res._getData());
    expect(events).toContainEqual({
      type: 'progress',
      payload: { index: 1, total: 2, file: 'direct.zip', status: 'success' },
    });
    expect(events).toContainEqual({
      type: 'progress',
      payload: { index: 2, total: 2, file: 'cross-device.zip', status: 'success' },
    });
    expect(events.at(-1)).toEqual({ type: 'done', payload: { success: true } });
  });
});
