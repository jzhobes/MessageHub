import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatasetGenerationPayload, useDatasetGeneration } from '@/hooks/useDatasetGeneration';

const samplePayload: DatasetGenerationPayload = {
  threadIds: ['t1'],
  identityNames: ['Me'],
  includeGroupSpeakerNames: true,
  mergeSequential: true,
  removeSystemMessages: true,
  imputeReactions: true,
  redactPII: false,
  splitDataset: false,
  maxTokensPerSession: 12000,
  personaTag: '',
  customInstructions: '',
  skipSystemMessages: true,
  datasetName: 'my_dataset',
};

describe('useDatasetGeneration', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('polls sequentially without overlap and triggers download on completion', async () => {
    let pollCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/studio/generate-dataset') {
        return Promise.resolve(new Response(JSON.stringify({ jobId: 'job-123' }), { status: 202 }));
      }
      if (url === '/api/job-status?id=job-123') {
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'job-123', status: 'processing', progress: 1, total: 2 }), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'job-123', status: 'completed', progress: 2, total: 2 }), {
            status: 200,
          }),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useDatasetGeneration(5));

    await act(async () => {
      await result.current.generate(samplePayload);
    });

    expect(pollCount).toBe(2);
    expect(result.current.generating).toBe(false);
    expect(result.current.progress).toEqual({ current: 2, total: 2 });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('alerts and resets generating state when background job fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/studio/generate-dataset') {
        return Promise.resolve(new Response(JSON.stringify({ jobId: 'job-fail' }), { status: 202 }));
      }
      if (url === '/api/job-status?id=job-fail') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'job-fail', status: 'failed', error: 'No valid data' }), { status: 200 }),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useDatasetGeneration(5));

    await act(async () => {
      await result.current.generate(samplePayload);
    });

    expect(result.current.generating).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith('Generation failed: No valid data');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('cancels polling and suppresses download on unmount', async () => {
    let pollCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/studio/generate-dataset') {
        return Promise.resolve(new Response(JSON.stringify({ jobId: 'job-unmount' }), { status: 202 }));
      }
      if (url === '/api/job-status?id=job-unmount') {
        pollCalls++;
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useDatasetGeneration(5));

    let pendingGen: Promise<void>;
    act(() => {
      pendingGen = result.current.generate(samplePayload);
    });

    await waitFor(() => {
      expect(pollCalls).toBe(1);
    });

    unmount();
    await act(async () => {
      await pendingGen!;
    });

    expect(pollCalls).toBe(1);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
