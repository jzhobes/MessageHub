// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fileSystem from '@/lib/server/fileSystem';

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
  fs.rmSync(base, { recursive: true, force: true });
});

describe('filesystem path boundaries', () => {
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

  it('does not follow an external workspace database symlink for metadata', async () => {
    const db = path.join(outside, 'messagehub.db');
    fs.writeFileSync(db, 'private');
    fs.symlinkSync(db, path.join(workspaceRoot, 'messagehub.db'));
    await expect(fileSystem.getPathMetadata(workspaceRoot)).resolves.toMatchObject({ isExistingWorkspace: false });
  });
});
