import { useState, useRef, useEffect } from 'react';

export function useIngestion() {
  const [isInstalling, setIsInstalling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);

  // Use refs for counting to avoid stale closures in SSE handler
  const totalArchivesRef = useRef(0);
  const extractedArchivesRef = useRef(0);
  const totalFilesRef = useRef(0);
  const processedFilesRef = useRef(0);

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
    setLogs(['Initializing...']);
    setProgress(0);

    // Reset refs
    totalArchivesRef.current = 0;
    extractedArchivesRef.current = 0;
    totalFilesRef.current = 0;
    processedFilesRef.current = 0;

    const hasTransfer = remoteFiles.length > 0;
    const transferWeight = 40; // 0-40%
    const ingestOffset = hasTransfer ? transferWeight : 0;
    const ingestWeight = 100 - ingestOffset;

    // --- 1. Transfer Remote ---
    if (hasTransfer) {
      setStatus(`${transferMode === 'copy' ? 'Copying' : 'Moving'} files...`);
      try {
        // Use GET with EventSource for simple streaming progress
        const params = new URLSearchParams({
          files: JSON.stringify(remoteFiles),
          operation: transferMode,
        });

        await new Promise<void>((resolve, reject) => {
          const evt = new EventSource(`/api/setup/transfer?${params.toString()}`);

          evt.onmessage = (event) => {
            const json = JSON.parse(event.data);
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
              evt.close();
              resolve();
            }
            if (json.type === 'error') {
              evt.close();
              reject(new Error(json.payload));
            }
          };

          evt.onerror = () => {
            evt.close();
            reject(new Error('Connection to transfer service lost'));
          };
        });

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

    // Upload Browser Files (Placeholder for now as in current SetupModal) if (files.length > 0) ...

    // --- 2. Ingest ---
    setStatus('Scanning...');
    setIsInstalling(true);
    // Start ingestion progress at offset (5% of its own range)
    setProgress(ingestOffset + Math.round(ingestWeight * 0.05));

    const evtSource = new EventSource(`/api/setup/ingest?deleteArchives=true`);

    evtSource.onmessage = (event) => {
      try {
        const json = JSON.parse(event.data);

        if (json.payload && typeof json.payload === 'string') {
          setLogs((p) => [...p, json.payload]);

          // Parse explicit Error signals from backend
          if (json.payload.includes('[Error]:')) {
            const err = json.payload.split('[Error]:')[1].trim();
            setError(err);
            setStatus('Failed');
            setIsInstalling(false);
            evtSource.close();
            return;
          }

          // Parse TotalArchives
          const totalArchivesMatch = json.payload.match(/\[TotalArchives\]: (\d+)/);
          if (totalArchivesMatch) {
            totalArchivesRef.current = parseInt(totalArchivesMatch[1], 10);
          }

          // Parse ArchiveStarted
          if (json.payload.includes('[ArchiveStarted]:')) {
            const parts = json.payload.split(']:')[1].trim().split('|');
            setStatus(`Extracting ${parts[0]}...`);
          }

          // Parse ArchiveProgress
          if (json.payload.includes('[ArchiveProgress]:')) {
            const parts = json.payload.split(']:')[1].trim().split('|');
            const name = parts[0];
            const current = parseInt(parts[1], 10);
            const total = parseInt(parts[2], 10);
            setStatus(`Extracting ${name} (${current}/${total})...`);
          }

          // Parse ArchiveExtracted
          if (json.payload.includes('[ArchiveExtracted]:')) {
            extractedArchivesRef.current += 1;
            const name = json.payload.split(']:')[1].trim();
            setStatus(`Extracted ${name}`);

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
          }

          // Track progress (Ingestion)
          if (json.payload.includes('[Ingesting]:')) {
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
            setStatus(json.payload.split(']:')[1].trim());
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
          evtSource.close();
        }

        if (json.type === 'error') {
          setError(json.payload);
          setLogs((p) => [...p, `Error: ${json.payload}`]);
          evtSource.close();
          setIsInstalling(false);
        }
      } catch (e) {
        console.error('Failed to parse SSE', e);
      }
    };

    evtSource.onerror = (err) => {
      console.error('EventSource failed:', err);
      evtSource.close();
      if (!isComplete) {
        setIsInstalling(false);
        setError('Connection to session lost');
        setLogs((p) => [...p, 'Connection lost.']);
      }
    };
  };

  return {
    isInstalling,
    isComplete,
    logs,
    status,
    progress,
    error,
    runInstall,
  };
}
