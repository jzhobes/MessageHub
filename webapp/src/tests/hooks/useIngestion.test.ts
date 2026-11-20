import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIngestion } from '@/hooks/useIngestion';

function makeSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('useIngestion', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('completes cleanly when a terminal done event is split across network chunks', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/setup/ingest-status') {
        return Promise.resolve(new Response(JSON.stringify({ isRunning: false, isComplete: false }), { status: 200 }));
      }
      if (url.startsWith('/api/setup/ingest')) {
        return Promise.resolve(
          new Response(
            makeSSEBody([
              'data: {"type":"stdout","payload":"[TotalFiles]: 1"}\n\n',
              'data: {"type":"stdout","payload":"[Ingesting]: Facebook - chat"}\n\n',
              'data: {"type":"done","pay',
              'load":{"code":0}}\n\n',
            ]),
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIngestion());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/ingest-status');
    });

    await act(async () => {
      await result.current.runInstall([], 'keep');
    });

    expect(result.current.isInstalling).toBe(false);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.progress).toBe(100);
    expect(result.current.status).toBe('Complete');
    expect(result.current.error).toBeNull();
  });

  it('clears isInstalling and sets error when stream ends without a terminal event', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/setup/ingest-status') {
        return Promise.resolve(new Response(JSON.stringify({ isRunning: false, isComplete: false }), { status: 200 }));
      }
      if (url.startsWith('/api/setup/ingest')) {
        return Promise.resolve(
          new Response(makeSSEBody(['data: {"type":"stdout","payload":"[TotalFiles]: 2"}\n\n']), { status: 200 }),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIngestion());

    await act(async () => {
      await result.current.runInstall([], 'keep');
    });

    expect(result.current.isInstalling).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.status).toBe('Failed');
    expect(result.current.error).toBe('Ingestion stream ended unexpectedly');
  });

  it('sends selected archives directly to /api/setup/ingest without a separate transfer step', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/setup/ingest-status') {
        return Promise.resolve(new Response(JSON.stringify({ isRunning: false, isComplete: false }), { status: 200 }));
      }
      if (url === '/api/setup/ingest') {
        return Promise.resolve(
          new Response(
            makeSSEBody([
              'data: {"type":"stdout","payload":"[TotalArchives]: 1"}\n\n',
              'data: {"type":"stdout","payload":"[ArchiveExtracted]: fb.zip"}\n\n',
              'data: {"type":"done","payload":{"code":0}}\n\n',
            ]),
            { status: 200 },
          ),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIngestion());

    await act(async () => {
      await result.current.runInstall(['/import/fb.zip'], 'keep');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/setup/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: ['/import/fb.zip'], deleteArchives: false }),
    });
    expect(result.current.isInstalling).toBe(false);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.progress).toBe(100);
    expect(result.current.logs).toContain('Finished: fb.zip');
  });

  it('stays idle on mount when ingest-status reports a previously completed run', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/setup/ingest-status') {
        return Promise.resolve(new Response(JSON.stringify({ isRunning: false, isComplete: true }), { status: 200 }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIngestion());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/ingest-status');
    });

    expect(result.current.isInstalling).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.status).toBe('');
  });

  it('resets completed state back to idle via reset()', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/setup/ingest-status') {
        return Promise.resolve(new Response(JSON.stringify({ isRunning: false, isComplete: false }), { status: 200 }));
      }
      if (url === '/api/setup/ingest') {
        return Promise.resolve(
          new Response(makeSSEBody(['data: {"type":"done","payload":{"code":0}}\n\n']), { status: 200 }),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIngestion());

    await act(async () => {
      await result.current.runInstall(['/import/fb.zip'], 'keep');
    });
    expect(result.current.isComplete).toBe(true);
    expect(result.current.progress).toBe(100);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isComplete).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.status).toBe('');
    expect(result.current.logs).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
