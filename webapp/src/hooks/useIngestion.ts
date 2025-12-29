import { useEffect, useRef, useState } from 'react';

export interface ArchiveProgress {
  name: string;
  current: number;
  total: number;
}

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

  // Prevent accidental refresh during installation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isInstalling) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInstalling]);

  const runInstall = async (remoteFiles: string[], transferMode: 'copy' | 'move') => {
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
        const decoder = new TextDecoder();
        if (!reader) {
          throw new Error('No readable stream available');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          const messages = chunk.split('\n\n');

          for (const msg of messages) {
            if (msg.startsWith('data: ')) {
              const json = JSON.parse(msg.replace('data: ', ''));
              if (json.type === 'log') {
                setLogs((p) => [...p, json.payload]);
              }
              if (json.type === 'progress') {
                const { index, total, file, status, error: fileErr } = json.payload;
                const pct = Math.floor((index / total) * transferWeight);
                setProgress(pct);
                setLogs((p) => [...p, `[${index}/${total}] ${file}: ${status}${fileErr ? ` (${fileErr})` : ''}`]);
              }
              if (json.type === 'done') {
                break;
              }
              if (json.type === 'error') {
                throw new Error(json.payload);
              }
            }
          }
        }

        setLogs((p) => [...p, `Transfer complete.`]);
        setProgress(transferWeight);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'File transfer failed';
        setError(message);
        setLogs((p) => [...p, `Transfer failed: ${message}`]);
        setIsInstalling(false);
        return;
      }
    }

    // --- 2. Ingest ---
    setStatus('Scanning...');
    setIsInstalling(true);
    // Start ingestion progress at offset (5% of its own range)
    setProgress(ingestOffset + Math.round(ingestWeight * 0.05));

    const response = await fetch('/api/setup/ingest?deleteArchives=true', {
      method: 'POST',
    });

    if (!response.ok) {
      setError(`Ingest failed: ${response.statusText}`);
      setIsInstalling(false);
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      setError('No readable stream available for ingestion');
      setIsInstalling(false);
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      const messagesBuffer = chunk.split('\n\n');

      for (const msg of messagesBuffer) {
        if (!msg.startsWith('data: ')) {
          continue;
        }

        try {
          const json = JSON.parse(msg.replace('data: ', ''));

          if (json.payload && typeof json.payload === 'string') {
            // Parse explicit Error signals from backend
            if (json.payload.includes('[Error]:')) {
              setLogs((p) => [...p, json.payload]);
              const err = json.payload.split('[Error]:')[1].trim();
              setError(err);
              setStatus('Failed');
              setIsInstalling(false);
              return;
            }

            // Parse TotalArchives
            const totalArchivesMatch = json.payload.match(/\[TotalArchives\]: (\d+)/);
            if (totalArchivesMatch) {
              totalArchivesRef.current = parseInt(totalArchivesMatch[1], 10);
              setLogs((p) => [...p, json.payload]);
            }

            // Parse ArchiveStarted
            if (json.payload.includes('[ArchiveStarted]:')) {
              const parts = json.payload.split(']:')[1].trim().split('|');
              const name = parts[0];
              const total = parts.length > 1 ? parseInt(parts[1], 10) : 0;

              setStatus(`Extracting ${name}...`);
              setLogs((p) => [...p, `Starting extraction: ${name}`]);

              // Initialize progress bar immediately at 0
              if (total > 0) {
                transferMapRef.current = {
                  ...transferMapRef.current,
                  [name]: { name, current: 0, total },
                };
                setActiveTransfers({ ...transferMapRef.current });
              }
            }

            // Parse ArchiveProgress
            if (json.payload.includes('[ArchiveProgress]:')) {
              const parts = json.payload.split(']:')[1].trim().split('|');
              const name = parts[0];
              const current = parseInt(parts[1], 10);
              const total = parseInt(parts[2], 10);

              // Update tracker ref and state
              transferMapRef.current = {
                ...transferMapRef.current,
                [name]: { name, current, total },
              };
              setActiveTransfers({ ...transferMapRef.current });

              // Skip intermediate progress signatures for cleaner UI logs
              continue;
            }

            // Parse MergeProgress (Folder Consolidation)
            if (json.payload.includes('[MergeProgress]:')) {
              const parts = json.payload.split(']:')[1].trim().split('|');
              const name = `Consolidating ${parts[0]}`;
              const current = parseInt(parts[1], 10);
              const total = parseInt(parts[2], 10);

              // Update tracker ref and state
              transferMapRef.current = {
                ...transferMapRef.current,
                [name]: { name, current, total },
              };
              setActiveTransfers({ ...transferMapRef.current });

              // Skip intermediate progress signatures for cleaner UI logs
              continue;
            }

            // Parse ArchiveExtracted
            if (json.payload.includes('[ArchiveExtracted]:')) {
              extractedArchivesRef.current += 1;
              const name = json.payload.split(']:')[1].trim();
              setStatus(`Extracted ${name}`);
              setLogs((p) => [...p, `Finished: ${name}`]);

              // Remove from tracker
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
            const totalMatch = json.payload.match(/\[TotalFiles\]: (\d+)/);
            if (totalMatch) {
              totalFilesRef.current = parseInt(totalMatch[1], 10);
              setLogs((p) => [...p, json.payload]);
            }

            // Track progress (Ingestion)
            if (json.payload.includes('[Ingesting]:')) {
              setLogs((p) => [...p, json.payload]);
              setStatus(json.payload.split(']:')[1].trim() + '...');
              processedFilesRef.current += 1;

              // Ingestion phase: 30% to 100% of ingestion weight
              const hasArchives = totalArchivesRef.current > 0;
              const startOfPhase = hasArchives ? 0.3 : 0.0;
              const sizeOfPhase = 1.0 - startOfPhase;

              if (totalFilesRef.current > 0) {
                const phaseProgress = processedFilesRef.current / totalFilesRef.current;
                const phasePct = startOfPhase + phaseProgress * sizeOfPhase;
                const globalPct = ingestOffset + Math.min(Math.round(phasePct * ingestWeight), 99);
                setProgress(globalPct);
              } else {
                // Fallback bump
                setProgress((prev) => Math.min(prev + 1, 99));
              }
            } else if (json.payload.includes('[Committed]:')) {
              setLogs((p) => [...p, json.payload]);
              setStatus(json.payload.split(']:')[1].trim());
            } else {
              // General status logs
              if (!json.payload.startsWith('[')) {
                setLogs((p) => [...p, json.payload]);
              }
            }
          }

          if (json.type === 'done') {
            const code = (json.payload as { code?: number })?.code;
            if (code !== 0 && code !== undefined) {
              setError(`Process exited with code ${code}`);
              setStatus('Failed');
            } else {
              setIsComplete(true);
              setStatus('Complete');
              setProgress(100);
              setLogs((p) => [...p, 'Done!']);
            }
            setIsInstalling(false);
            setActiveTransfers({});
          }

          if (json.type === 'error') {
            setError(json.payload);
            setLogs((p) => [...p, `Error: ${json.payload}`]);
            setIsInstalling(false);
            setActiveTransfers({});
          }
        } catch (e) {
          console.error('Failed to parse SSE message', e);
        }
      }
    }
  };

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
