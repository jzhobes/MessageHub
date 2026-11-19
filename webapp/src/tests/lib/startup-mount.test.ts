// @vitest-environment node
import { execFileSync } from 'child_process';
import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runStartupChecks } from '@/lib/server/startup';
import appConfig from '@/lib/shared/appConfig';

vi.mock('child_process', () => ({ execFileSync: vi.fn() }));

describe('startup WSL mounting', () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
    vi.stubEnv('INSTAGRAM_AUTH', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get').mockReturnValue('/mnt/c/messages');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(process, 'on').mockReturnValue(process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('passes separate mount and signal cleanup arguments without a shell', async () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);

    await runStartupChecks();

    expect(vi.mocked(execFileSync).mock.calls).toEqual([
      ['sudo', ['mkdir', '-p', '/mnt/c'], { stdio: 'inherit' }],
      ['sudo', ['mount', '-t', 'drvfs', 'C:', '/mnt/c'], { stdio: 'inherit' }],
    ]);
    const hooks = vi.mocked(process.on).mock.calls;
    const cleanup = hooks.find(([signal]) => signal === 'SIGINT')?.[1];
    expect(cleanup).toBeTypeOf('function');
    expect(hooks.find(([signal]) => signal === 'SIGTERM')?.[1]).toBe(cleanup);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('test exit');
    });
    expect(() => cleanup!()).toThrow('test exit');
    expect(vi.mocked(execFileSync).mock.calls.slice(2)).toEqual([
      ['sudo', ['umount', '/mnt/c'], { stdio: 'inherit' }],
      ['sudo', ['rmdir', '/mnt/c'], { stdio: 'inherit' }],
    ]);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('unmounts and removes the mount directory when the data directory remains missing', async () => {
    await runStartupChecks();

    expect(vi.mocked(execFileSync).mock.calls.slice(2)).toEqual([
      ['sudo', ['umount', '/mnt/c'], { stdio: 'inherit' }],
      ['sudo', ['rmdir', '/mnt/c'], { stdio: 'inherit' }],
    ]);
    expect(process.on).not.toHaveBeenCalled();
  });

  it.each(['/home/user/mnt/c/messages', '/mnt/cc/messages', '/mnt/c;id/messages'])(
    'does not mount an unrelated or invalid drive path: %s',
    async (workspace) => {
      vi.mocked(vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get')).mockReturnValue(workspace);
      await runStartupChecks();
      expect(execFileSync).not.toHaveBeenCalled();
    },
  );

  it('only derives the drive letter from a path containing shell metacharacters', async () => {
    vi.spyOn(appConfig, 'WORKSPACE_PATH', 'get').mockReturnValue('/mnt/d/$(id); with spaces');
    await runStartupChecks();
    expect(execFileSync).toHaveBeenCalledWith('sudo', ['mount', '-t', 'drvfs', 'D:', '/mnt/d'], { stdio: 'inherit' });
  });

  it('does not mount when the workspace already exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await runStartupChecks();
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
