// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseEnv } from 'util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persistWorkspacePath, serializeWorkspacePath } from '@/lib/server/env';
import * as python from '@/lib/server/python';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-env-'));
  vi.spyOn(python, 'getProjectRoot').mockReturnValue(root);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('workspace configuration persistence', () => {
  it.each(['/data/a # folder/$&', "/data/it's a folder", '/data/quote"and`backtick', String.raw`C:\new\records`])(
    'round-trips path values: %s',
    async (value) => {
      fs.writeFileSync(path.join(root, '.env'), 'WORKSPACE_PATH=old\nROOT_WORKSPACE_PATH=/trusted\n');
      await persistWorkspacePath(value);
      const parsed = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
      expect(parsed.WORKSPACE_PATH).toBe(value);
      expect(parsed.ROOT_WORKSPACE_PATH).toBe('/trusted');
      expect(parsed.ROOT_IMPORT_PATH).toBe(os.homedir());
    },
  );

  it.each([
    '/data/new\nROOT_WORKSPACE_PATH=/',
    '/data/new\rOTHER=value',
    '/data/\0bad',
    '/data/$HOME',
    '/data/${HOME}',
    String.raw`/data/\$literal`,
  ])('rejects injected configuration without writing: %s', async (value) => {
    await expect(persistWorkspacePath(value)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
  });

  it('rejects paths without a lossless .env quotation', () => {
    expect(() => serializeWorkspacePath('/data/\'"`')).toThrow();
  });
});
