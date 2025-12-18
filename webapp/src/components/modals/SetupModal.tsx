import React, { useState, useEffect, useRef } from 'react';
import { FaFolder, FaTimes } from 'react-icons/fa';
import TextInput from '@/components/TextInput';
import styles from './SetupModal.module.css';

interface StepProps {
  styles: any;
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
  validateAndSavePath: (create?: boolean, confirmNotEmpty?: boolean) => void;
  defaultPath?: string;
}

function FolderStep({ styles, dataPath, setDataPath, setShowCreatePrompt, setValidationError, validationError, showCreatePrompt, validateAndSavePath, defaultPath }: FolderStepProps) {
  return (
    <div>
      <div className={styles.stepTitle}>Installation Folder</div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>Where would you like MessageHub to store its database and files?</p>
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
        <div style={{ color: showCreatePrompt ? '#d97706' : '#ef4444', marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.9em' }}>
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
}

function FilesStep({ styles, files, handleFiles }: FilesStepProps) {
  return (
    <div>
      <div className={styles.stepTitle}>Import Data</div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
        Select your export .zip files (Facebook, Instagram, Google Takeout).
        <br />
        You can also skip this and import later.
      </p>

      <label className={styles.secondaryButton} style={{ display: 'inline-block', marginBottom: 10 }}>
        Choose Files...
        <input type="file" multiple accept=".zip,.json" onChange={handleFiles} style={{ display: 'none' }} />
      </label>

      {files.length > 0 ? (
        <div className={styles.fileList}>
          {files.map((f, i) => (
            <div key={i}>
              📄 {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.fileList} style={{ fontStyle: 'italic' }}>
          No files selected
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

function InstallStep({ styles, statusText, isComplete, uploadProgress, files, showLogs, setShowLogs, logs, logsEndRef }: InstallStepProps) {
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
        <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>{isComplete ? 'All operations completed successfully.' : 'Please wait while MessageHub configures your data...'}</div>
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
  if (!isOpen) return null;

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
  }, [step]);

  // Reset step if initialStep changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(initialStep);
    }
  }, [isOpen, initialStep]);

  const validateAndSavePath = async (create = false, confirmNotEmpty = false) => {
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
    } catch (e) {
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

  const runInstallSequence = async () => {
    setIsInstalling(true);

    // 1. Upload
    if (files.length > 0) {
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
            if (xhr.status === 200) resolve();
            else reject('Upload failed');
          };
          xhr.onerror = () => reject('Upload network error');
          xhr.send(formData);
        });
      } catch (e) {
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
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

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
            } catch (e) {}
          }
        }
      }
    } catch (e) {
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
    } catch (e) {
      onCompleted();
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
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
                validateAndSavePath={validateAndSavePath}
                defaultPath={resolvedPath || undefined}
              />
            )}
            {step === 2 && <FilesStep styles={styles} files={files} handleFiles={handleFiles} />}
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
          <div style={{ flex: 1 }}>{step === 3 && !isComplete && <span style={{ fontSize: '0.9em', color: 'gray' }}>Installing...</span>}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {step > (initialStep && initialStep > 0 ? 1 : 0) && step < 3 && (
              <button className={styles.secondaryButton} onClick={() => setStep((step - 1) as any)}>
                {step === 2 ? 'Change Data Path' : '< Back'}
              </button>
            )}

            {step === 0 && (
              <button className={styles.button} onClick={() => setStep(1)}>
                Next &gt;
              </button>
            )}

            {step === 1 && (
              <button className={styles.button} onClick={() => validateAndSavePath(false, showCreatePrompt)} disabled={configLoading}>
                {showCreatePrompt ? 'Use Existing Folder' : 'Next >'}
              </button>
            )}

            {step === 2 && (
              <button className={styles.button} onClick={() => setStep(3)}>
                {files.length > 0 ? 'Install' : 'Skip & Install'}
              </button>
            )}

            {step === 3 && (
              <button className={styles.button} onClick={handleFinish} disabled={!isComplete}>
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
