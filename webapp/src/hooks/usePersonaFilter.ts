import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Thread } from '@/lib/shared/types';

interface UsePersonaFilterProps {
  visibleThreads: Thread[];
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setFilterStatus?: (status: string | null) => void;
  setFilterProgress?: (progress: number) => void;
}

export function usePersonaFilter({
  visibleThreads,
  setSelectedIds,
  setFilterStatus,
  setFilterProgress,
}: UsePersonaFilterProps) {
  const [personaCache, setPersonaCache] = useState<Record<string, Set<string>>>({});
  const [activePersonas, setActivePersonas] = useState<Set<string>>(new Set());
  const [scanningLabels, setScanningLabels] = useState<Set<string>>(new Set());

  // Refs for logic that needs current state without triggering re-renders
  const activePersonasRef = useRef(new Set<string>());
  const batchCountsRef = useRef<Record<string, number>>({});
  const scannedIdsRef = useRef<Record<string, Set<string>>>({});
  const pendingCompletionRef = useRef<Set<string>>(new Set());
  const filterWorkerRef = useRef<Worker | null>(null);

  // Sync ref
  useEffect(() => {
    activePersonasRef.current = activePersonas;
  }, [activePersonas]);

  // Worker Setup
  const setupFilterWorker = useCallback(() => {
    if (!filterWorkerRef.current) {
      const worker = new Worker('/workers/style-worker.js', { type: 'module' });
      worker.onmessage = (e) => {
        const { type, id, matches, labels: echoedLabels, message, progress } = e.data;

        if (type === 'filter:match') {
          // Update Cache
          setPersonaCache((prev) => {
            const next = { ...prev };
            if (!next[id]) {
              next[id] = new Set();
            }
            matches.forEach((m: string) => next[id].add(m));
            return next;
          });
        } else if (type === 'filter:complete') {
          if (echoedLabels) {
            const label = echoedLabels[0];

            // Decrement active batch count
            const currentCount = (batchCountsRef.current[label] || 0) - 1;
            batchCountsRef.current[label] = Math.max(0, currentCount);

            if (batchCountsRef.current[label] === 0) {
              setScanningLabels((prev) => {
                const next = new Set(prev);
                next.delete(label);
                return next;
              });

              // Check if we were pending completion (scan loop finished)
              if (pendingCompletionRef.current.has(label)) {
                pendingCompletionRef.current.delete(label);
              }
            }
          }
        } else if (type === 'filter:status') {
          if (setFilterStatus) {
            setFilterStatus(message);
          }
        } else if (type === 'filter:progress') {
          if (setFilterStatus) {
            setFilterStatus(message);
          }
          if (setFilterProgress && progress) {
            setFilterProgress(progress);
          }
        }
      };
      filterWorkerRef.current = worker;
    }
    return filterWorkerRef.current;
  }, [setFilterStatus, setFilterProgress]);

  // Sync Selection with Cache & Active Personas
  useEffect(() => {
    if (activePersonas.size === 0) {
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      let changed = false;

      for (const [id, labels] of Object.entries(personaCache)) {
        let hasMatch = false;
        for (const p of Array.from(activePersonas)) {
          if (labels.has(p)) {
            hasMatch = true;
            break;
          }
        }

        if (hasMatch && !next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [personaCache, activePersonas, setSelectedIds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (filterWorkerRef.current) {
        filterWorkerRef.current.terminate();
      }
    };
  }, []);

  const scanLabel = useCallback(
    async (label: string) => {
      const worker = setupFilterWorker();

      setScanningLabels((prev) => {
        const next = new Set(prev);
        next.add(label);
        return next;
      });

      // Initialize scanned set if needed
      if (!scannedIdsRef.current[label]) {
        scannedIdsRef.current[label] = new Set();
      }

      const allIds = visibleThreads.map((t) => t.id);
      const BATCH_SIZE = 20;

      (async () => {
        for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
          // Cancellation Check
          if (!activePersonasRef.current.has(label)) {
            pendingCompletionRef.current.delete(label);
            break;
          }

          const rawBatchIds = allIds.slice(i, i + BATCH_SIZE);

          // Filter out already scanned
          const batchIds = rawBatchIds.filter((id) => !scannedIdsRef.current[label].has(id));

          if (batchIds.length === 0) {
            continue;
          }

          try {
            const res = await fetch('/api/studio/thread-content', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: batchIds }),
            });

            if (!res.ok) {
              console.error('Scan fetch failed:', res.status, await res.text());
              continue; // Skip and retry later (not marked as scanned)
            }

            const contentMap = await res.json();

            const threadPayload = batchIds.map((id) => ({
              id,
              messages: contentMap[id] || [],
            }));

            // Mark as scanned immediately (optimistic)
            batchIds.forEach((id) => scannedIdsRef.current[label].add(id));

            // Increment pending count
            batchCountsRef.current[label] = (batchCountsRef.current[label] || 0) + 1;

            worker.postMessage({
              type: 'filter_threads',
              threads: threadPayload,
              labels: [label],
              // isLast is handled by pendingCompletionRef now
            });

            await new Promise((r) => setTimeout(r, 50));
          } catch (e) {
            console.error(e);
          }
        }

        // Loop Finished Check (if still active)
        if (activePersonasRef.current.has(label)) {
          pendingCompletionRef.current.add(label);

          // If nothing is pending (e.g. all skipped), finish immediately
          if ((batchCountsRef.current[label] || 0) === 0) {
            setScanningLabels((prev) => {
              const next = new Set(prev);
              next.delete(label);
              return next;
            });
            pendingCompletionRef.current.delete(label);
          }
        }
      })();
    },
    [setupFilterWorker, visibleThreads],
  );

  const handleTogglePersona = useCallback(
    (label: string) => {
      const isActive = activePersonas.has(label);
      const nextActive = new Set(activePersonas);

      if (isActive) {
        // Toggling OFF
        nextActive.delete(label);
        setActivePersonas(nextActive);
        activePersonasRef.current = nextActive; // Immediate sync for cancellation

        // Remove from pending completion if cancelled
        pendingCompletionRef.current.delete(label);

        // Remove selection for threads that matched THIS label but no other active label
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const [id, labels] of Object.entries(personaCache)) {
            if (labels.has(label)) {
              let keep = false;
              for (const other of Array.from(nextActive)) {
                if (labels.has(other)) {
                  keep = true;
                  break;
                }
              }
              if (!keep) {
                next.delete(id);
              }
            }
          }
          return next;
        });
      } else {
        // Toggling ON
        nextActive.add(label);
        setActivePersonas(nextActive);
        activePersonasRef.current = nextActive; // Immediate sync for startup

        // Scan (idempotent due to scannedIdsRef)
        if (!scanningLabels.has(label)) {
          scanLabel(label);
        }
      }
    },
    [activePersonas, scanningLabels, personaCache, scanLabel, setSelectedIds],
  );

  const stopScanning = useCallback(() => {
    if (filterWorkerRef.current) {
      filterWorkerRef.current.terminate();
      filterWorkerRef.current = null;
    }
    setScanningLabels(new Set());
    batchCountsRef.current = {};
    pendingCompletionRef.current.clear();
  }, []);

  // Auto-scan on new threads (Reactive to visibleThreads changes)
  const previousThreadCountRef = useRef(visibleThreads.length);
  useEffect(() => {
    if (visibleThreads.length !== previousThreadCountRef.current) {
      previousThreadCountRef.current = visibleThreads.length;
      // If threads changed, ensure active personas cover new threads
      activePersonas.forEach((label) => {
        if (!scanningLabels.has(label)) {
          scanLabel(label);
        }
      });
    }
  }, [visibleThreads, activePersonas, scanningLabels, scanLabel]);

  const personaCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(personaCache).forEach((labels) => {
      labels.forEach((label) => {
        counts[label] = (counts[label] || 0) + 1;
      });
    });
    return counts;
  }, [personaCache]);

  return {
    activePersonas,
    scanningLabels,
    handleTogglePersona,
    stopScanning,
    personaCounts,
  };
}
