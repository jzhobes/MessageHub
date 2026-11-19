import { useCallback, useEffect, useRef, useState } from 'react';

export interface DatasetGenerationPayload {
  threadIds: string[];
  identityNames: string[];
  includeGroupSpeakerNames: boolean;
  mergeSequential: boolean;
  removeSystemMessages: boolean;
  imputeReactions: boolean;
  redactPII: boolean;
  splitDataset: boolean;
  maxTokensPerFile?: number;
  maxTokensPerSession: number;
  personaTag: string;
  customInstructions: string;
  skipSystemMessages: boolean;
  datasetName: string;
  dateRange?: { start: number; end: number };
  outputFormat?: 'jsonl' | 'markdown';
  selectedDaysByThread?: Record<string, string[]>;
  timeZone?: string;
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Owns the asynchronous dataset generation lifecycle: job creation, sequential non-overlapping
 * status polling, browser download trigger on completion, and cancellation on unmount or re-run.
 */
export function useDatasetGeneration(pollIntervalMs = 1000) {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setGenerating(false);
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const generate = useCallback(
    async (payload: DatasetGenerationPayload, downloadFileName: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const { signal } = controller;

      setGenerating(true);
      setProgress({ current: 0, total: 0 });

      try {
        const res = await fetch('/api/studio/generate-dataset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });

        if (signal.aborted) {
          return;
        }

        if (!res.ok) {
          const err = await res.json();
          if (!signal.aborted) {
            alert('Error: ' + err.error);
          }
          return;
        }

        const { jobId } = await res.json();

        while (!signal.aborted) {
          await waitWithAbort(pollIntervalMs, signal);
          if (signal.aborted) {
            return;
          }

          try {
            const statusRes = await fetch(`/api/job-status?id=${jobId}`, { signal });
            if (signal.aborted) {
              return;
            }
            if (!statusRes.ok) {
              continue;
            }

            const job = await statusRes.json();
            if (signal.aborted) {
              return;
            }

            setProgress({ current: job.progress ?? 0, total: job.total ?? 0 });

            if (job.status === 'completed') {
              const downloadUrl = `/api/studio/generate-dataset?jobId=${jobId}`;
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = `${downloadFileName || 'virtual_me'}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              return;
            }

            if (job.status === 'failed') {
              alert('Generation failed: ' + (job.error || 'Unknown error'));
              return;
            }
          } catch (pollErr) {
            if (signal.aborted || (pollErr instanceof Error && pollErr.name === 'AbortError')) {
              return;
            }
            console.error('Polling error', pollErr);
          }
        }
      } catch (e) {
        if (signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
          return;
        }
        console.error(e);
        alert('Generation failed to start');
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setGenerating(false);
        }
      }
    },
    [pollIntervalMs],
  );

  return {
    generating,
    progress,
    generate,
    cancel,
  };
}
