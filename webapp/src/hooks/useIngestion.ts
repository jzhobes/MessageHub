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

    // Transfer Remote
    if (remoteFiles.length > 0) {
      setStatus('Moving files...');
      try {
        await fetch('/api/setup/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: remoteFiles, operation: transferMode }),
        });
        setLogs((p) => [...p, `Transferred ${remoteFiles.length} files.`]);
      } catch {
        setError('File transfer failed');
        setLogs((p) => [...p, 'Transfer failed.']);
        setIsInstalling(false);
        return;
      }
    }

    // Upload Browser Files (Placeholder for now as in current SetupModal) if (files.length > 0) ...

    // Ingest
    setStatus('Scanning...');
    setIsInstalling(true);
    setProgress(5); // Start at 5%

    const evtSource = new EventSource('/api/setup/ingest');

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

          // Parse ArchiveExtracted
          if (json.payload.includes('[ArchiveExtracted]:')) {
            extractedArchivesRef.current += 1;
            setStatus('Extracting ' + json.payload.split(']:')[1].trim() + '...');

            // Phase 1 Progress: 0-30%
            if (totalArchivesRef.current > 0) {
              const pct = Math.min(Math.round((extractedArchivesRef.current / totalArchivesRef.current) * 30), 30);
              setProgress(Math.max(pct, 5));
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

            // Phase 2 Progress: 30-100% (or 0-100 if no archives)
            const hasArchives = totalArchivesRef.current > 0;
            const basePct = hasArchives ? 30 : 0;
            const range = hasArchives ? 70 : 100;

            if (totalFilesRef.current > 0) {
              const filePct = processedFilesRef.current / totalFilesRef.current;
              const finalPct = Math.min(Math.round(basePct + filePct * range), 99);
              setProgress(Math.max(finalPct, 5));
            } else {
              // Fallback
              setProgress((prev) => Math.min(prev + 2, 95));
            }
          } else if (json.payload.includes('[Committed]:')) {
            setStatus(json.payload.split(']:')[1].trim());
            if (totalFilesRef.current === 0) {
              setProgress((prev) => Math.min(prev + 2, 95));
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
