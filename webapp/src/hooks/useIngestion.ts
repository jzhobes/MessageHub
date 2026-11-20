import { useCallback, useEffect, useRef, useState } from 'react';

import { readSSEStream, SSEEvent } from '@/lib/shared/sseClient';

export interface ArchiveProgress {
  name: string;
  current: number;
  total: number;
}

export type ArchiveMode = 'keep' | 'delete';

/**
 * Turn SSE markers from `scripts/ingest.py` into 0–100% progress. Archive markers are
 * `[TotalArchives]`, `[ArchiveStarted]`, `[ArchiveProgress]`, `[MergeProgress]`, and
 * `[ArchiveExtracted]`. Import markers are `[TotalFiles]`, `[Ingesting]`, `[Committed]`, and
 * `[Error]`.
 * Warn before leaving during ingestion and reconnect on mount if the server is still working.
 */
export function useIngestion() {
  const [isInstalling, setIsInstalling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [activeTransfers, setActiveTransfers] = useState<Record<string, ArchiveProgress>>({});

  // Keep counts in refs so the SSE handler always reads the latest values.
  const totalArchivesRef = useRef(0);
  const extractedArchivesRef = useRef(0);
  const totalFilesRef = useRef(0);
  const processedFilesRef = useRef(0);
  const transferMapRef = useRef<Record<string, ArchiveProgress>>({});

  const [error, setError] = useState<string | null>(null);

  const hasCheckedInFlightRef = useRef(false);

  const handleIngestEvent = useCallback((event: SSEEvent): 'terminal' | 'continue' => {
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

        // Extraction gets the first 30% of the progress bar.
        if (totalArchivesRef.current > 0) {
          const phasePct = (extractedArchivesRef.current / totalArchivesRef.current) * 0.3;
          setProgress(Math.round(phasePct * 100));
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
          setProgress(Math.min(Math.round(phasePct * 100), 99));
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
  }, []);

  /**
   * Stream extraction and import progress over SSE. An empty `remoteFiles` array uses the workspace
   * archives or reconnects to a job that's already running.
   */
  const runInstall = useCallback(
    async (remoteFiles: string[], archiveMode: ArchiveMode = 'keep') => {
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

      try {
        setStatus('Scanning...');
        setProgress(5);

        const response = await fetch(`/api/setup/ingest${remoteFiles.length === 0 ? '?reattach=true' : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: remoteFiles,
            deleteArchives: archiveMode === 'delete',
          }),
        });

        if (!response.ok) {
          let errText = `Ingest failed: ${response.statusText}`;
          try {
            const data = await response.json();
            if (data?.error) {
              errText = data.error;
            }
          } catch {
            // Use statusText if there's no better error message.
          }
          setError(errText);
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
          if (handleIngestEvent(event) === 'terminal') {
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
    [handleIngestEvent],
  );

  const reset = useCallback(() => {
    setIsComplete(false);
    setError(null);
    setLogs([]);
    setStatus('');
    setProgress(0);
    setActiveTransfers({});

    totalArchivesRef.current = 0;
    extractedArchivesRef.current = 0;
    totalFilesRef.current = 0;
    processedFilesRef.current = 0;
    transferMapRef.current = {};
  }, []);

  // Warn before refresh during ingestion and reconnect on mount.
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
            // Call start with no files to attach to the running job.
            runInstall([], 'keep');
          }
        }
      } catch (e) {
        console.error('Failed to check in-flight ingestion:', e);
      }
    };

    checkInFlight();

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInstalling, runInstall]);

  return {
    isInstalling,
    isComplete,
    logs,
    status,
    progress,
    error,
    activeTransfers,
    runInstall,
    reset,
  };
}
