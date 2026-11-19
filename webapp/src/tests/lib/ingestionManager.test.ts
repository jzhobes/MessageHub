// @vitest-environment node
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ingestionManager } from '@/lib/server/ingestionManager';
import { getIngestScriptPath, getPythonPath } from '@/lib/server/python';

import type { ChildProcess } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('@/lib/server/python', () => ({
  getPythonPath: vi.fn(),
  getIngestScriptPath: vi.fn(),
}));

function makeFakeChild() {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  child.stdout = new EventEmitter() as ChildProcess['stdout'];
  child.stderr = new EventEmitter() as ChildProcess['stderr'];
  return child;
}

describe('ingestionManager', () => {
  beforeEach(() => {
    const g = global as typeof globalThis & {
      _ingestionState?: {
        process: ChildProcess | null;
        startPromise: Promise<ChildProcess> | null;
        logs: { type: string; payload: string }[];
        isComplete: boolean;
        exitCode: number | null;
      };
    };
    if (g._ingestionState) {
      g._ingestionState.process = null;
      g._ingestionState.startPromise = null;
      g._ingestionState.logs = [];
      g._ingestionState.isComplete = false;
      g._ingestionState.exitCode = null;
    }

    vi.mocked(getIngestScriptPath).mockReturnValue('/scripts/ingest.py');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes concurrent start() calls while getPythonPath is pending and spawns only once', async () => {
    let resolvePython!: (p: string) => void;
    vi.mocked(getPythonPath).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePython = resolve;
        }),
    );

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const p1 = ingestionManager.start(true);
    const p2 = ingestionManager.start(false);

    expect(p1).toBe(p2);
    expect(ingestionManager.getState().isRunning).toBe(true);
    expect(spawn).not.toHaveBeenCalled();

    resolvePython('/venv/bin/python');
    const [child1, child2] = await Promise.all([p1, p2]);

    expect(child1).toBe(fakeChild);
    expect(child2).toBe(fakeChild);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      '/venv/bin/python',
      ['-u', '/scripts/ingest.py', '--delete-archives'],
      expect.any(Object),
    );

    fakeChild.stdout?.emit('data', Buffer.from('Line 1\nLine 2\n'));
    fakeChild.stderr?.emit('data', 'Warn 1\n');
    expect(ingestionManager.getState().logs).toEqual([
      { type: 'stdout', payload: 'Line 1' },
      { type: 'stdout', payload: 'Line 2' },
      { type: 'stderr', payload: 'Warn 1' },
    ]);

    fakeChild.emit('close', 0);
    expect(ingestionManager.getState()).toMatchObject({
      isRunning: false,
      isComplete: true,
      exitCode: 0,
    });
  });

  it('clears startPromise on startup failure so subsequent start() calls can retry', async () => {
    const fakeChild = makeFakeChild();
    vi.mocked(getPythonPath)
      .mockRejectedValueOnce(new Error('Python missing'))
      .mockResolvedValueOnce('/venv/bin/python');
    vi.mocked(spawn).mockReturnValue(fakeChild);

    await expect(ingestionManager.start(false)).rejects.toThrow('Python missing');
    expect(ingestionManager.getState().isRunning).toBe(false);

    const child = await ingestionManager.start(false);
    expect(child).toBe(fakeChild);
    expect(spawn).toHaveBeenCalledTimes(1);

    fakeChild.emit('close', 0);
  });
});
