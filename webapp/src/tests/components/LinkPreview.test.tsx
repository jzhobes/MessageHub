import React from 'react';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LinkPreview, { clearLinkPreviewCache } from '@/components/LinkPreview';

describe('LinkPreview', () => {
  beforeEach(() => {
    class ImmediateIntersectionObserver {
      private callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = '';
      thresholds = [];
    }

    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    clearLinkPreviewCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('completes loading and renders preview metadata under React StrictMode', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
        queueMicrotask(() => {
          if (!init?.signal?.aborted) {
            resolve(
              new Response(
                JSON.stringify({
                  url: 'https://example.com/post',
                  title: 'Strict Mode Safe Title',
                  description: 'Preview description',
                }),
                { status: 200 },
              ),
            );
          }
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <React.StrictMode>
        <LinkPreview url="https://example.com/post" />
      </React.StrictMode>,
    );

    expect(await screen.findByText('Strict Mode Safe Title')).toBeTruthy();
    expect(screen.queryByText('Loading preview...')).toBeNull();
  });

  it('aborts in-flight preview request when unmounted', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal) {
        signals.push(init.signal);
      }
      return new Promise<Response>(() => {
        // Leave the preview request pending on purpose.
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<LinkPreview url="https://example.com/slow" />);

    await waitFor(() => {
      expect(signals.length).toBeGreaterThan(0);
    });
    expect(signals[0].aborted).toBe(false);

    unmount();

    expect(signals[0].aborted).toBe(true);
  });

  it('reuses cached preview synchronously on remount without refetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: 'https://example.com/cached',
          title: 'Cached Title',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<LinkPreview url="https://example.com/cached" />);
    expect(await screen.findByText('Cached Title')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();

    // Mount the same URL again. The preview should appear immediately from cache with no extra fetch.
    render(<LinkPreview url="https://example.com/cached" />);
    expect(screen.getByText('Cached Title')).toBeTruthy();
    expect(screen.queryByText('Loading preview...')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
