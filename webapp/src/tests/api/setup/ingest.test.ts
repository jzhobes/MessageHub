// @vitest-environment node
import { EventEmitter } from 'events';

import { createMocks } from 'node-mocks-http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestionManager } from '@/lib/server/ingestionManager';
import handler from '@/pages/api/setup/ingest';

import { createStreamingMocks, parseSSEEvents } from '../../helpers/httpHelpers';

import type { ChildProcess } from 'child_process';

function createFakeChildProcess() {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  child.stdout = new EventEmitter() as ChildProcess['stdout'];
  child.stderr = new EventEmitter() as ChildProcess['stderr'];
  return child;
}

describe('/api/setup/ingest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getHeaders().allow).toEqual(['POST']);
  });

  it('replays buffered logs and closes immediately when ingestion is already complete', async () => {
    const child = createFakeChildProcess();
    vi.spyOn(ingestionManager, 'start').mockResolvedValue(child);
    vi.spyOn(ingestionManager, 'getState').mockReturnValue({
      isRunning: false,
      isComplete: true,
      exitCode: 0,
      logs: [
        { type: 'stdout', payload: 'Line 1' },
        { type: 'stderr', payload: 'Warn 1' },
      ],
    });

    const { req, res } = createStreamingMocks({
      method: 'POST',
      query: { deleteArchives: 'true' },
    });

    await handler(req, res);

    expect(ingestionManager.start).toHaveBeenCalledWith(true);
    expect(res._isEndCalled()).toBe(true);
    expect(res._getHeaders()['content-type']).toBe('text/event-stream');
    expect(parseSSEEvents(res._getData())).toEqual([
      { type: 'stdout', payload: 'Line 1' },
      { type: 'stderr', payload: 'Warn 1' },
      { type: 'done', payload: { code: 0 } },
    ]);
  });

  it('streams multi-line stdout/stderr chunks and emits done when child closes', async () => {
    const child = createFakeChildProcess();
    vi.spyOn(ingestionManager, 'start').mockResolvedValue(child);
    vi.spyOn(ingestionManager, 'getState').mockReturnValue({
      isRunning: true,
      isComplete: false,
      exitCode: null,
      logs: [{ type: 'stdout', payload: 'Buffered line' }],
    });

    const { req, res } = createStreamingMocks({ method: 'POST', query: {} });

    await handler(req, res);

    expect(ingestionManager.start).toHaveBeenCalledWith(false);
    expect(res._isEndCalled()).toBe(false);

    child.stdout?.emit('data', Buffer.from('  first line \n\n  second line  \n'));
    child.stderr?.emit('data', 'err line\n   ');
    child.emit('close', 0);

    expect(res._isEndCalled()).toBe(true);
    expect(parseSSEEvents(res._getData())).toEqual([
      { type: 'stdout', payload: 'Buffered line' },
      { type: 'stdout', payload: 'first line' },
      { type: 'stdout', payload: 'second line' },
      { type: 'stderr', payload: 'err line' },
      { type: 'done', payload: { code: 0 } },
    ]);
  });

  it('detaches listeners and closes stream on client disconnect without killing child', async () => {
    const child = createFakeChildProcess();
    vi.spyOn(ingestionManager, 'start').mockResolvedValue(child);
    vi.spyOn(ingestionManager, 'getState').mockReturnValue({
      isRunning: true,
      isComplete: false,
      exitCode: null,
      logs: [],
    });

    const { req, res } = createStreamingMocks({ method: 'POST', query: {} });

    await handler(req, res);

    expect(child.stdout?.listenerCount('data')).toBe(1);
    expect(child.stderr?.listenerCount('data')).toBe(1);
    expect(child.listenerCount('close')).toBe(1);

    req.emit('close');

    expect(child.stdout?.listenerCount('data')).toBe(0);
    expect(child.stderr?.listenerCount('data')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
    expect(res._isEndCalled()).toBe(true);
  });
});
