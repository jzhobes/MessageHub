import { useState } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergePersonaCacheMatches, usePersonaFilter } from '@/hooks/usePersonaFilter';

import type { Thread } from '@/lib/shared/types';

class MockWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public postedMessages: unknown[] = [];
  public terminate = vi.fn();

  postMessage(msg: unknown) {
    this.postedMessages.push(msg);
    const payload = msg as { type: string; threads?: Array<{ id: string }>; labels?: string[] };
    if (payload.type === 'filter_threads' && payload.threads && payload.labels) {
      const label = payload.labels[0];
      queueMicrotask(() => {
        for (const t of payload.threads!) {
          this.onmessage?.({
            data: { type: 'filter:match', id: t.id, matches: [label] },
          } as MessageEvent);
        }
        this.onmessage?.({
          data: { type: 'filter:complete', labels: [label] },
        } as MessageEvent);
      });
    }
  }
}

describe('usePersonaFilter', () => {
  let createdWorkers: MockWorker[] = [];

  beforeEach(() => {
    createdWorkers = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          const instance = new MockWorker();
          createdWorkers.push(instance);
          return instance as unknown as Worker;
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mergePersonaCacheMatches returns a new Set without mutating previous Set instances', () => {
    const initialSet = new Set(['Casual']);
    const prev = { t1: initialSet };

    const next = mergePersonaCacheMatches(prev, 't1', ['Technical']);

    expect(initialSet.has('Technical')).toBe(false);
    expect(next.t1).not.toBe(initialSet);
    expect(Array.from(next.t1).sort()).toEqual(['Casual', 'Technical']);
  });

  it('rescans when visibleThreads replaces [A] with [B] of the same length', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { ids: string[] };
      const contentMap: Record<string, string[]> = {};
      for (const id of body.ids) {
        contentMap[id] = [`sample from ${id}`];
      }
      return Promise.resolve(new Response(JSON.stringify(contentMap), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const threadA: Thread = { id: 'thread_A', title: 'A', timestamp: 1, snippet: '', participants: [], pageCount: 1 };
    const threadB: Thread = { id: 'thread_B', title: 'B', timestamp: 2, snippet: '', participants: [], pageCount: 1 };

    const { result, rerender } = renderHook(
      ({ threads }: { threads: Thread[] }) => {
        const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
        const filter = usePersonaFilter({ visibleThreads: threads, setSelectedIds });
        return { ...filter, selectedIds };
      },
      { initialProps: { threads: [threadA] } },
    );

    act(() => {
      result.current.handleTogglePersona('Professional');
    });

    await waitFor(() => {
      expect(result.current.selectedIds.has('thread_A')).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.scanningLabels.size).toBe(0);
    });

    // Swap threadA for threadB without changing the visible count.
    rerender({ threads: [threadB] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/studio/thread-content',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ids: ['thread_B'] }),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.selectedIds.has('thread_B')).toBe(true);
    });
    expect(result.current.personaCounts.Professional).toBe(2);
    expect(createdWorkers.length).toBe(1);
  });
});
