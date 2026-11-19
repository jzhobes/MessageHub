// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fileSystem from '@/lib/server/fileSystem';
import { canonicalizePath } from '@/lib/server/pathValidators';

let base: string;
let importRoot: string;
let workspaceRoot: string;
let outside: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-path-safety-')));
  importRoot = path.join(base, 'import');
  workspaceRoot = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  for (const dir of [importRoot, workspaceRoot, outside]) {
    fs.mkdirSync(dir);
  }
  vi.spyOn(fileSystem, 'getRoot').mockImplementation((mode) => (mode === 'workspace' ? workspaceRoot : importRoot));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

describe('filesystem path boundaries', () => {
  it('rejects an outside candidate before any filesystem probe', () => {
    const realpath = vi.spyOn(fs, 'realpathSync');
    const lstat = vi.spyOn(fs, 'lstatSync');

    expect(() => canonicalizePath(path.join(outside, 'missing'), workspaceRoot)).toThrow('PERMISSION_DENIED');
    expect(realpath).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it('stops at a missing root rather than probing its parent', () => {
    const root = path.join(workspaceRoot, 'missing-root');
    const realpath = vi.spyOn(fs, 'realpathSync');
    const lstat = vi.spyOn(fs, 'lstatSync');

    expect(() => canonicalizePath(path.join(root, 'child'), root)).toThrow('PERMISSION_DENIED');
    expect(realpath.mock.calls.map(([candidate]) => candidate)).toEqual([path.join(root, 'child'), root]);
    expect(lstat.mock.calls.map(([candidate]) => candidate)).toEqual([path.join(root, 'child')]);
  });

  it.each(['outside', 'escaping-link', 'dangling-link'])(
    'preserves directory metadata with an invalid active workspace: %s',
    async (kind) => {
      let active = path.join(outside, 'missing');
      if (kind !== 'outside') {
        active = path.join(workspaceRoot, kind);
        fs.symlinkSync(kind === 'escaping-link' ? outside : path.join(outside, 'missing'), active, 'dir');
      }
      vi.stubEnv('WORKSPACE_PATH', active);
      fs.writeFileSync(path.join(workspaceRoot, 'messagehub.db'), 'workspace');

      await expect(fileSystem.getPathMetadata(workspaceRoot)).resolves.toMatchObject({
        exists: true,
        isWritable: true,
        isEmpty: false,
        isExistingWorkspace: true,
        isActive: false,
        isNested: false,
      });
    },
  );

  it('compares active and nested directories using validated canonical paths', async () => {
    const active = path.join(workspaceRoot, 'active');
    const nested = path.join(active, 'nested');
    const alias = path.join(workspaceRoot, 'alias');
    fs.mkdirSync(nested, { recursive: true });
    fs.symlinkSync(active, alias, 'dir');
    vi.stubEnv('WORKSPACE_PATH', alias);

    await expect(fileSystem.getPathMetadata(active)).resolves.toMatchObject({ isActive: true, isNested: false });
    await expect(fileSystem.getPathMetadata(nested)).resolves.toMatchObject({ isActive: false, isNested: true });
  });

  it('allows the root, normalized descendants and missing nested directories', () => {
    expect(fileSystem.resolveSafePath('import')).toBe(importRoot);
    expect(fileSystem.resolveSafePath('import', path.join(importRoot, 'folder', '..', 'file.zip'))).toBe(
      path.join(importRoot, 'file.zip'),
    );
    const missing = path.join(workspaceRoot, 'new', 'nested');
    expect(fileSystem.resolveSafePath('workspace', missing)).toBe(missing);
  });

  it('rejects traversal, sibling-prefix paths, null bytes and the wrong mode root', () => {
    for (const target of [
      path.join(importRoot, '..', 'outside'),
      `${importRoot}-sibling`,
      `${importRoot}/bad\0path`,
      workspaceRoot,
    ]) {
      expect(() => fileSystem.resolveSafePath('import', target)).toThrow('PERMISSION_DENIED');
    }
  });

  it.each(['import', 'workspace'] as const)('rejects symlink escapes and missing descendants in %s mode', (mode) => {
    const root = mode === 'import' ? importRoot : workspaceRoot;
    const link = path.join(root, 'escape');
    fs.symlinkSync(outside, link, 'dir');
    for (const target of [link, path.join(link, 'new', 'nested')]) {
      expect(() => fileSystem.resolveSafePath(mode, target)).toThrow('PERMISSION_DENIED');
    }
  });

  it('allows internal symlinks and returns the canonical target', () => {
    const actual = path.join(importRoot, 'actual');
    const alias = path.join(importRoot, 'alias');
    fs.mkdirSync(actual);
    fs.symlinkSync(actual, alias, 'dir');
    expect(fileSystem.resolveSafePath('import', alias)).toBe(actual);
    expect(fileSystem.resolveSafePath('import', path.join(alias, 'new'))).toBe(path.join(actual, 'new'));
  });

  it('supports a configured root that is itself a symlink', () => {
    const alias = path.join(base, 'root-alias');
    fs.symlinkSync(importRoot, alias, 'dir');
    vi.mocked(fileSystem.getRoot).mockReturnValue(alias);
    expect(fileSystem.resolveSafePath('import', path.join(alias, 'file.zip'))).toBe(path.join(importRoot, 'file.zip'));
    expect(fileSystem.getSafeParent('import', importRoot)).toBeNull();
  });

  it('rejects dangling symlinks, including their missing descendants', () => {
    const link = path.join(workspaceRoot, 'dangling');
    fs.symlinkSync(path.join(outside, 'missing'), link, 'dir');
    expect(() => fileSystem.resolveSafePath('workspace', link)).toThrow('PERMISSION_DENIED');
    expect(() => fileSystem.resolveSafePath('workspace', path.join(link, 'new'))).toThrow('PERMISSION_DENIED');
  });

  it('enforces boundaries when filesystem methods are called directly', async () => {
    fs.symlinkSync(outside, path.join(importRoot, 'escape'), 'dir');
    fs.symlinkSync(outside, path.join(workspaceRoot, 'escape'), 'dir');
    await expect(fileSystem.listContents(outside)).rejects.toThrow('PERMISSION_DENIED');
    await expect(fileSystem.listContents(path.join(importRoot, 'escape'))).rejects.toThrow('PERMISSION_DENIED');
    await expect(fileSystem.getPathMetadata(path.join(workspaceRoot, 'escape'))).rejects.toThrow('PERMISSION_DENIED');
    await expect(fileSystem.listContents(workspaceRoot, undefined, 'workspace')).resolves.toEqual([]);
  });

  it('reuses the canonical root within a listing and refreshes it for the next operation', async () => {
    const alias = path.join(base, 'root-alias');
    fs.symlinkSync(importRoot, alias, 'dir');
    vi.mocked(fileSystem.getRoot).mockReturnValue(alias);
    fs.writeFileSync(path.join(importRoot, 'first.txt'), 'first');
    fs.writeFileSync(path.join(importRoot, 'second.txt'), 'second');
    const realpath = vi.spyOn(fs, 'realpathSync');

    expect(await fileSystem.listContents(alias)).toHaveLength(2);
    expect(realpath.mock.calls.filter(([candidate]) => candidate === alias)).toHaveLength(2);

    fs.unlinkSync(alias);
    fs.symlinkSync(workspaceRoot, alias, 'dir');
    fs.writeFileSync(path.join(workspaceRoot, 'next.txt'), 'next');
    expect(await fileSystem.listContents(alias)).toEqual([
      { name: 'next.txt', path: path.join(workspaceRoot, 'next.txt'), type: 'file', size: 4 },
    ]);
  });

  it('does not follow an external workspace database symlink for metadata', async () => {
    const db = path.join(outside, 'messagehub.db');
    fs.writeFileSync(db, 'private');
    fs.symlinkSync(db, path.join(workspaceRoot, 'messagehub.db'));
    await expect(fileSystem.getPathMetadata(workspaceRoot)).resolves.toMatchObject({ isExistingWorkspace: false });
  });
});
