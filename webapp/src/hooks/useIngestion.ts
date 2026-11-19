import { useCallback, useEffect, useRef, useState } from 'react';

import { readSSEStream, SSEEvent } from '@/lib/shared/sseClient';

export interface ArchiveProgress {
  name: string;
  current: number;
  total: number;
}

/**
 * Orchestrates the two-phase setup pipeline: optional archive copy/move (0–40% progress weight)
 * followed by SSE ingestion (40–100%, or 0–100% without transfers). Parses bracketed progress markers
 * from `scripts/ingest.py` (`[TotalArchives]`, `[ArchiveStarted]`, `[ArchiveProgress]`, `[MergeProgress]`,
 * `[ArchiveExtracted]`, `[TotalFiles]`, `[Ingesting]`, `[Committed]`, `[Error]`), registers a
 * `beforeunload` warning while active, and auto-reattaches on mount if a server ingestion is in flight.
 */
export function useIngestion() {
  const [isInstalling, setIsInstalling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [activeTransfers, setActiveTransfers] = useState<Record<string, ArchiveProgress>>({});

  // Use refs for counting and tracking to avoid stale closures in SSE handler
  const totalArchivesRef = useRef(0);
  const extractedArchivesRef = useRef(0);
  const totalFilesRef = useRef(0);
  const processedFilesRef = useRef(0);
  const transferMapRef = useRef<Record<string, ArchiveProgress>>({});

  const [error, setError] = useState<string | null>(null);

  const hasCheckedInFlightRef = useRef(false);

  const handleTransferEvent = useCallback((event: SSEEvent, transferWeight: number): boolean | void => {
    if (event.type === 'log' && typeof event.payload === 'string') {
      const msg = event.payload;
      setLogs((p) => [...p, msg]);
    } else if (event.type === 'progress' && event.payload && typeof event.payload === 'object') {
      const {
        index,
        total,
        file,
        status: itemStatus,
        error: fileErr,
      } = event.payload as {
        index: number;
        total: number;
        file: string;
        status: string;
        error?: string;
      };
      const pct = Math.floor((index / total) * transferWeight);
      setProgress(pct);
      setLogs((p) => [...p, `[${index}/${total}] ${file}: ${itemStatus}${fileErr ? ` (${fileErr})` : ''}`]);
    } else if (event.type === 'done') {
      return false;
    } else if (event.type === 'error') {
      throw new Error(typeof event.payload === 'string' ? event.payload : 'File transfer failed');
    }
  }, []);

  const handleIngestEvent = useCallback(
    (event: SSEEvent, ingestOffset: number, ingestWeight: number): 'terminal' | 'continue' => {
      if (event.payload && typeof event.payload === 'string') {
        const line = event.payload;

        // Explicit Error signals from backend
        if (line.includes('[Error]:')) {
          setLogs((p) => [...p, line]);
          const err = line.split('[Error]:')[1].trim();
          setError(err);
          setStatus('Failed');
          return 'terminal';
        }

        // Parse TotalArchives
        const totalArchivesMatch = line.match(/\[TotalArchives\]: (\d+)/);
        if (totalArchivesMatch) {
          totalArchivesRef.current = parseInt(totalArchivesMatch[1], 10);
          setLogs((p) => [...p, line]);
        }

        // Parse ArchiveStarted
        if (line.includes('[ArchiveStarted]:')) {
          const parts = line.split(']:')[1].trim().split('|');
          const name = parts[0];
          const total = parts.length > 1 ? parseInt(parts[1], 10) : 0;

          setStatus(`Extracting ${name}...`);
          setLogs((p) => [...p, `Starting extraction: ${name}`]);

          if (total > 0) {
            transferMapRef.current = {
              ...transferMapRef.current,
              [name]: { name, current: 0, total },
            };
            setActiveTransfers({ ...transferMapRef.current });
          }
        }

        // Parse ArchiveProgress
        if (line.includes('[ArchiveProgress]:')) {
          const parts = line.split(']:')[1].trim().split('|');
          const name = parts[0];
          const current = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);

          transferMapRef.current = {
            ...transferMapRef.current,
            [name]: { name, current, total },
          };
          setActiveTransfers({ ...transferMapRef.current });
          return 'continue';
        }

        // Parse MergeProgress (Folder Consolidation)
        if (line.includes('[MergeProgress]:')) {
          const parts = line.split(']:')[1].trim().split('|');
          const name = `Consolidating ${parts[0]}`;
          const current = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);

          transferMapRef.current = {
            ...transferMapRef.current,
            [name]: { name, current, total },
          };
          setActiveTransfers({ ...transferMapRef.current });
          return 'continue';
        }

        // Parse ArchiveExtracted
        if (line.includes('[ArchiveExtracted]:')) {
          extractedArchivesRef.current += 1;
          const name = line.split(']:')[1].trim();
          setStatus(`Extracted ${name}`);
          setLogs((p) => [...p, `Finished: ${name}`]);

          const newMap = { ...transferMapRef.current };
          delete newMap[name];
          transferMapRef.current = newMap;
          setActiveTransfers(newMap);

          // Extraction phase: first 30% of ingestion weight
          if (totalArchivesRef.current > 0) {
            const phasePct = (extractedArchivesRef.current / totalArchivesRef.current) * 0.3;
            const globalPct = ingestOffset + Math.round(phasePct * ingestWeight);
            setProgress(globalPct);
          }
        }

        // Parse TotalFiles
        const totalMatch = line.match(/\[TotalFiles\]: (\d+)/);
        if (totalMatch) {
          totalFilesRef.current = parseInt(totalMatch[1], 10);
          setLogs((p) => [...p, line]);
        }

        // Track progress (Ingestion)
        if (line.includes('[Ingesting]:')) {
          setLogs((p) => [...p, line]);
          setStatus(line.split(']:')[1].trim() + '...');
          processedFilesRef.current += 1;

          const hasArchives = totalArchivesRef.current > 0;
          const startOfPhase = hasArchives ? 0.3 : 0.0;
          const sizeOfPhase = 1.0 - startOfPhase;

          if (totalFilesRef.current > 0) {
            const phaseProgress = processedFilesRef.current / totalFilesRef.current;
            const phasePct = startOfPhase + phaseProgress * sizeOfPhase;
            const globalPct = ingestOffset + Math.min(Math.round(phasePct * ingestWeight), 99);
            setProgress(globalPct);
          } else {
            setProgress((prev) => Math.min(prev + 1, 99));
          }
        } else if (line.includes('[Committed]:')) {
          setLogs((p) => [...p, line]);
          setStatus(line.split(']:')[1].trim());
        } else if (!line.startsWith('[')) {
          setLogs((p) => [...p, line]);
        }
      }

      if (event.type === 'done') {
        const code = (event.payload as { code?: number } | null)?.code;
        if (code !== 0 && code !== undefined) {
          setError(`Process exited with code ${code}`);
          setStatus('Failed');
        } else {
          setIsComplete(true);
          setStatus('Complete');
          setProgress(100);
          setLogs((p) => [...p, 'Done!']);
        }
        return 'terminal';
      }

      if (event.type === 'error') {
        const errMsg = typeof event.payload === 'string' ? event.payload : 'Ingestion failed';
        setError(errMsg);
        setLogs((p) => [...p, `Error: ${errMsg}`]);
        setStatus('Failed');
        return 'terminal';
      }

      return 'continue';
    },
    [],
  );

  /**
   * Transfers `remoteFiles` when non-empty, then streams ingestion progress over SSE.
   * Passing an empty `remoteFiles` array skips the transfer phase and attaches with `reattach=true`
   * to an already-running server ingestion.
   */
  const runInstall = useCallback(
    async (remoteFiles: string[], transferMode: 'copy' | 'move') => {
      setIsInstalling(true);
      setIsComplete(false);
      setError(null);
      setLogs([]);
      setProgress(0);
      setActiveTransfers({});

      // Reset refs
      totalArchivesRef.current = 0;
      extractedArchivesRef.current = 0;
      totalFilesRef.current = 0;
      processedFilesRef.current = 0;
      transferMapRef.current = {};

      const hasTransfer = remoteFiles.length > 0;
      const transferWeight = 40; // 0-40%
      const ingestOffset = hasTransfer ? transferWeight : 0;
      const ingestWeight = 100 - ingestOffset;

      try {
        // --- 1. Transfer Remote ---
        if (hasTransfer) {
          setStatus(`${transferMode === 'copy' ? 'Copying' : 'Moving'} files...`);
          try {
            const response = await fetch('/api/setup/transfer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                files: remoteFiles,
                operation: transferMode,
              }),
            });

            if (!response.ok) {
              throw new Error(`Transfer failed: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error('No readable stream available');
            }

            await readSSEStream(reader, (event) => handleTransferEvent(event, transferWeight));

            setLogs((p) => [...p, 'Transfer complete.']);
            setProgress(transferWeight);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'File transfer failed';
            setError(message);
            setLogs((p) => [...p, `Transfer failed: ${message}`]);
            setStatus('Failed');
            return;
          }
        }

        // --- 2. Ingest ---
        setStatus('Scanning...');
        setProgress(ingestOffset + Math.round(ingestWeight * 0.05));

        const response = await fetch(
          `/api/setup/ingest?deleteArchives=true${remoteFiles.length === 0 ? '&reattach=true' : ''}`,
          {
            method: 'POST',
          },
        );

        if (!response.ok) {
          setError(`Ingest failed: ${response.statusText}`);
          setStatus('Failed');
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError('No readable stream available for ingestion');
          setStatus('Failed');
          return;
        }

        let reachedTerminalState = false;
        await readSSEStream(reader, (event) => {
          if (handleIngestEvent(event, ingestOffset, ingestWeight) === 'terminal') {
            reachedTerminalState = true;
            return false;
          }
        });

        if (!reachedTerminalState) {
          setError('Ingestion stream ended unexpectedly');
          setStatus('Failed');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Installation failed';
        setError(message);
        setLogs((p) => [...p, `Error: ${message}`]);
        setStatus('Failed');
      } finally {
        setIsInstalling(false);
        setActiveTransfers({});
      }
    },
    [handleTransferEvent, handleIngestEvent],
  );

  // Prevent accidental refresh during installation and re-attach to in-flight ingestion on mount
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isInstalling) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Initial check for in-flight ingestion
    const checkInFlight = async () => {
      if (hasCheckedInFlightRef.current) {
        return;
      }
      hasCheckedInFlightRef.current = true;

      try {
        const res = await fetch('/api/setup/ingest-status');
        if (res.ok) {
          const data = await res.json();
          if (data.isRunning) {
            // If already running, we can "start" it with no parameters to just attach
            runInstall([], 'copy');
          } else if (data.isComplete && !isComplete) {
            // If finished while we were gone, mark as complete
            setIsComplete(true);
            setStatus('Complete');
            setProgress(100);
          }
        }
      } catch (e) {
        console.error('Failed to check in-flight ingestion:', e);
      }
    };

    checkInFlight();

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInstalling, isComplete, runInstall]);

  return {
    isInstalling,
    isComplete,
    logs,
    status,
    progress,
    error,
    activeTransfers,
    runInstall,
  };
}
