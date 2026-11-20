import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch, resolveDemoDownloadUrl } from '@/lib/client/apiClient';
import { IS_DEMO_MODE } from '@/lib/client/env';
import { getDatasetBaseName } from '@/lib/shared/dataset/datasetFilename';

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
 * Start a dataset job, poll one request at a time, and download the result when it's ready. Cancel
 * tracking on unmount or when a new run starts.
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
    async (payload: DatasetGenerationPayload) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const { signal } = controller;

      setGenerating(true);
      setProgress({ current: 0, total: 0 });

      try {
        const res = await apiFetch('/api/studio/generate-dataset', {
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
            const statusRes = await apiFetch(`/api/job-status?id=${jobId}`, { signal });
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
              let downloadUrl = `/api/studio/generate-dataset?jobId=${jobId}`;
              let isBlobUrl = false;
              if (IS_DEMO_MODE) {
                const demoUrl = await resolveDemoDownloadUrl(jobId);
                if (demoUrl) {
                  downloadUrl = demoUrl;
                  isBlobUrl = true;
                }
              }
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = `${getDatasetBaseName(payload.datasetName, payload.outputFormat)}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              if (isBlobUrl) {
                setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
              }
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
