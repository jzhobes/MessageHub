import React, { useState, useEffect, useRef } from 'react';
import { FaFolder, FaTimes } from 'react-icons/fa';
import TextInput from '@/components/TextInput';
import FileExplorer from '@/components/FileExplorer';
import BaseModal from './BaseModal';
import styles from './SetupModal.module.css';

interface StepProps {
  styles: Record<string, string>;
}

function WelcomeStep({ styles }: StepProps) {
  return (
    <div className={styles.welcomeContainer}>
      <div className={styles.leftRail} />
      <div className={styles.welcomeContent}>
        <h2 className={styles.welcomeTitle}>Welcome to MessageHub</h2>
        <p className={styles.welcomeText}>
          Craft your authentic AI persona.
          <br />
          <br />
          This wizard will help you forge your chat data into a personalized AI-ready dataset on your local machine.
          <br />
          <br />
          Click Next to continue.
        </p>
      </div>
    </div>
  );
}

interface FolderStepProps extends StepProps {
  dataPath: string;
  setDataPath: (path: string) => void;
  setShowCreatePrompt: (show: boolean) => void;
  setValidationError: (error: string | null) => void;
  validationError: string | null;
  showCreatePrompt: boolean;
  defaultPath?: string;
}

function FolderStep({
  styles,
  dataPath,
  setDataPath,
  setShowCreatePrompt,
  setValidationError,
  validationError,
  showCreatePrompt,
  defaultPath,
}: FolderStepProps) {
  return (
    <div>
      <div className={styles.stepTitle}>Installation Folder</div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
        Where would you like MessageHub to store its database and files?
      </p>
      <div className={styles.inputGroup}>
        <TextInput
          value={dataPath}
          onChange={(e) => {
            setDataPath(e.target.value);
            setShowCreatePrompt(false);
            setValidationError(null);
          }}
          placeholder={defaultPath || '/path/to/data'}
          adornment={<FaFolder />}
        />
      </div>

      {validationError && (
        <div
          style={{
            color: showCreatePrompt ? '#d97706' : '#ef4444',
            marginTop: 10,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            fontSize: '0.9em',
          }}
        >
          <span>{showCreatePrompt ? '⚠️' : '⚠️'}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>{validationError}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface FilesStepProps extends StepProps {
  files: File[];
  handleFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  dataPath?: string;
  remoteFiles: string[];
  setRemoteFiles: (files: string[]) => void;
  showExplorer: boolean;
  setShowExplorer: (show: boolean) => void;
  transferMode: 'copy' | 'move';
  setTransferMode: (mode: 'copy' | 'move') => void;
}

function FilesStep({
  styles,
  files,
  handleFiles,
  dataPath,
  remoteFiles,
  setRemoteFiles,
  showExplorer,
  setShowExplorer,
  transferMode,
  setTransferMode,
}: FilesStepProps) {
  if (showExplorer) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className={styles.stepTitle} style={{ margin: 0 }}>
            Browse System Files
          </div>
          <button
            className={styles.secondaryButton}
            onClick={() => setShowExplorer(false)}
            style={{ fontSize: '0.8em', padding: '4px 8px' }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <FileExplorer
            onSelectionChange={setRemoteFiles}
            height="100%"
            actionPanel={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 2,
                    background: 'var(--input-bg)',
                    padding: 2,
                    borderRadius: 6,
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <button
                    onClick={() => setTransferMode('copy')}
                    style={{
                      background: transferMode === 'copy' ? 'var(--bubble-sent-bg)' : 'transparent',
                      color: transferMode === 'copy' ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 12px',
                      fontSize: '0.9em',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => setTransferMode('move')}
                    style={{
                      background: transferMode === 'move' ? 'var(--bubble-sent-bg)' : 'transparent',
                      color: transferMode === 'move' ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 12px',
                      fontSize: '0.9em',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Move
                  </button>
                </div>
                <div
                  style={{
                    fontSize: '0.9em',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 200,
                    textAlign: 'right',
                  }}
                  title={`to ${dataPath}`}
                >
                  to <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{dataPath?.split('/').pop()}</span>
                </div>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.stepTitle}>Import Data</div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
        Select your export .zip files (Facebook, Instagram, Google Takeout).
      </p>

      {/* Manual Hint */}
      <div
        style={{
          background: 'var(--input-bg)',
          padding: 12,
          borderRadius: 6,
          marginBottom: 20,
          fontSize: '0.9em',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Fast Track (Local):</div>
        <div style={{ color: 'var(--text-secondary)' }}>
          Manually copy files to:{' '}
          <span style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.1)', padding: '2px 4px', borderRadius: 4 }}>
            {dataPath || '...'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
        <button className={styles.secondaryButton} onClick={() => setShowExplorer(true)}>
          Browse System...
        </button>
        <label className={styles.secondaryButton} style={{ display: 'inline-block', margin: 0 }}>
          Upload via Browser...
          <input type="file" multiple accept=".zip,.json" onChange={handleFiles} style={{ display: 'none' }} />
        </label>
      </div>

      {files.length > 0 || remoteFiles.length > 0 ? (
        <div className={styles.fileList}>
          {remoteFiles.map((f, i) => (
            <div key={`remote-${i}`}>
              🖥️ {f.split('/').pop()?.split('\\').pop()}{' '}
              <span style={{ opacity: 0.6, fontSize: '0.85em' }}>(System {transferMode})</span>
            </div>
          ))}
          {files.map((f, i) => (
            <div key={`local-${i}`}>
              📄 {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.fileList} style={{ fontStyle: 'italic' }}>
          No files selected (will scan folder)
        </div>
      )}
    </div>
  );
}

interface InstallStepProps extends StepProps {
  statusText: string;
  isComplete: boolean;
  uploadProgress: number;
  files: File[];
  isInstalling: boolean;
  showLogs: boolean;
  setShowLogs: (show: boolean) => void;
  logs: string[];
  logsEndRef: React.RefObject<HTMLDivElement | null>;
}

function InstallStep({
  styles,
  statusText,
  isComplete,
  uploadProgress,
  files,
  showLogs,
  setShowLogs,
  logs,
  logsEndRef,
}: InstallStepProps) {
  return (
    <div>
      <div className={styles.stepTitle}>{statusText || 'Installing...'}</div>

      {/* Progress Bar */}
      <div className={styles.progressBar}>
        {/* Simple indeterminant progress if processing, or upload progress */}
        <div
          className={styles.progressFill}
          style={{
            width: isComplete ? '100%' : uploadProgress > 0 && files.length > 0 ? `${uploadProgress}%` : '50%',
            transition: 'width 0.5s',
          }}
        />
      </div>

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
          {isComplete
            ? 'All operations completed successfully.'
            : 'Please wait while MessageHub configures your data...'}
        </div>
        <button className={styles.secondaryButton} onClick={() => setShowLogs(!showLogs)}>
          {showLogs ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {showLogs && (
        <div className={styles.terminal} style={{ marginTop: 15, height: 250 }}>
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
  initialStep?: 0 | 1 | 2;
}

export default function SetupModal({ isOpen, onClose, onCompleted, initialStep = 0 }: SetupModalProps) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(initialStep);
  const [configLoading, setConfigLoading] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dataPath, setDataPath] = useState('');
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);

  // Step 2: Files
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Step 3: Install
  const [statusText, setStatusText] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load initial config
  useEffect(() => {
    (async () => {
      try {
        const data = await (await fetch('/api/setup/config')).json();
        setDataPath(data.resolved);
        setResolvedPath(data.resolved);
      } catch (e) {
        console.error('Failed to load config', e);
      } finally {
        setConfigLoading(false);
      }
    })();
  }, []);
  // Auto-scroll logs
  useEffect(() => {
    if (showLogs) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  // Auto-start install when entering step 3
  useEffect(() => {
    if (step === 3 && !isInstalling && !isComplete) {
      runInstallSequence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Reset step if initialStep changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(initialStep);
    }
  }, [isOpen, initialStep]);

  const validateAndSavePath = async (confirmNotEmpty = false) => {
    setConfigLoading(true);
    setValidationError(null);

    // Use user input, or fallback to the resolved path we loaded at start
    const pathToSend = dataPath || resolvedPath;
    const shouldCreate = true; // Always try to create if missing (auto-create)

    try {
      const res = await fetch('/api/setup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataPath: pathToSend, create: shouldCreate }),
      });
      const data = await res.json();

      if (res.ok) {
        setResolvedPath(data.resolved);

        if (data.exists) {
          if (data.isEmpty || confirmNotEmpty) {
            setStep(2);
            setShowCreatePrompt(false);
          } else {
            // Exists but NOT empty
            setValidationError('This folder is not empty. Existing files may be used or modified by MessageHub.');
            setShowCreatePrompt(true);
          }
        } else {
          setValidationError(`Could not access or create folder: ${data.resolved}`);
        }
      } else {
        setValidationError(data.error || 'Unknown error');
      }
    } catch {
      setValidationError('Network error');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  // ... inside SetupModal component ...
  const [remoteFiles, setRemoteFiles] = useState<string[]>([]);
  const [showExplorer, setShowExplorer] = useState(false);
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');

  // ... runInstallSequence update ...
  const runInstallSequence = async () => {
    setIsInstalling(true);

    // 0. Transfer Remote Files (if any)
    if (remoteFiles.length > 0) {
      setStatusText(`Transferring ${remoteFiles.length} remote files...`);
      try {
        const res = await fetch('/api/setup/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: remoteFiles, operation: transferMode }),
        });
        if (!res.ok) {
          throw new Error('Transfer failed');
        }
      } catch {
        setStatusText('File Transfer Failed');
        setIsInstalling(false);
        return;
      }
    }

    // 1. Upload Browser Files
    if (files.length > 0) {
      // ... existing upload logic ...

      setStatusText('Uploading files...');
      try {
        await new Promise<void>((resolve, reject) => {
          const formData = new FormData();
          files.forEach((f) => formData.append('files', f));
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/setup/upload');
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadProgress((event.loaded / event.total) * 100);
            }
          };
          xhr.onload = () => {
            if (xhr.status === 200) {
              resolve();
            } else {
              reject('Upload failed');
            }
          };
          xhr.onerror = () => reject('Upload network error');
          xhr.send(formData);
        });
      } catch {
        setStatusText('Upload Failed');
        setIsInstalling(false);
        return;
      }
    }

    // 2. Ingest
    setStatusText('Processing data...');
    setLogs(['Starting ingestion...']);

    try {
      const response = await fetch('/api/setup/ingest', { method: 'POST' });
      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (block.startsWith('data: ')) {
            try {
              const msg = JSON.parse(block.replace('data: ', ''));
              if (msg.type === 'stdout' || msg.type === 'stderr') {
                setLogs((prev) => [...prev.slice(-200), msg.payload]);
              }
              if (msg.type === 'done') {
                setLogs((prev) => [...prev, '--- Complete ---']);
                setIsComplete(true);
                setIsInstalling(false);
                setStatusText('Installation Complete');
              }
              if (msg.type === 'error') {
                setLogs((prev) => [...prev, 'Error: ' + msg.payload]);
                setStatusText('Error during processing');
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch {
      setStatusText('Processing Failed');
      setIsInstalling(false);
    }
  };

  const handleFinish = async () => {
    setStatusText('Saving configuration...');
    try {
      await fetch('/api/setup/finalize', { method: 'POST' });
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch {
      onCompleted();
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth={900}
      height="80vh"
      hideHeader
      overlayClassName={styles.overlay}
      className={styles.modal}
    >
      {/* Header */}
      <div className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={{ fontSize: '1.2em' }}>💬</span>
          <h2>MessageHub Setup</h2>
        </div>
        <button onClick={onClose} className={styles.closeButton}>
          <FaTimes />
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        <div key={step} className={styles.stepContent}>
          {step === 0 && <WelcomeStep styles={styles} />}
          {step === 1 && (
            <FolderStep
              styles={styles}
              dataPath={dataPath}
              setDataPath={setDataPath}
              setShowCreatePrompt={setShowCreatePrompt}
              setValidationError={setValidationError}
              validationError={validationError}
              showCreatePrompt={showCreatePrompt}
              defaultPath={resolvedPath || undefined}
            />
          )}
          {step === 2 && (
            <FilesStep
              styles={styles}
              files={files}
              handleFiles={handleFiles}
              dataPath={resolvedPath || dataPath}
              remoteFiles={remoteFiles}
              setRemoteFiles={setRemoteFiles}
              showExplorer={showExplorer}
              setShowExplorer={setShowExplorer}
              transferMode={transferMode}
              setTransferMode={setTransferMode}
            />
          )}
          {step === 3 && (
            <InstallStep
              styles={styles}
              statusText={statusText}
              isComplete={isComplete}
              uploadProgress={uploadProgress}
              files={files}
              isInstalling={isInstalling}
              showLogs={showLogs}
              setShowLogs={setShowLogs}
              logs={logs}
              logsEndRef={logsEndRef}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div style={{ flex: 1 }}>
          {step === 3 && !isComplete && <span style={{ fontSize: '0.9em', color: 'gray' }}>Installing...</span>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > (initialStep && initialStep > 0 ? 1 : 0) && step < 3 && (
            <button className={styles.secondaryButton} onClick={() => setStep((step - 1) as 0 | 1 | 2 | 3)}>
              {step === 2 ? 'Change Data Path' : '< Back'}
            </button>
          )}

          {step === 0 && (
            <button className={styles.button} onClick={() => setStep(1)}>
              Next &gt;
            </button>
          )}

          {step === 1 && (
            <button
              className={styles.button}
              onClick={() => validateAndSavePath(showCreatePrompt)}
              disabled={configLoading}
            >
              {showCreatePrompt ? 'Use Existing Folder' : 'Next >'}
            </button>
          )}

          {step === 2 && (
            <button className={styles.button} onClick={() => setStep(3)}>
              {files.length > 0 || remoteFiles.length > 0 ? 'Install' : 'Scan & Install'}
            </button>
          )}

          {step === 3 && (
            <button className={styles.button} onClick={handleFinish} disabled={!isComplete}>
              Finish
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
