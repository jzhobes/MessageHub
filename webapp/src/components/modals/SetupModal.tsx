import React, { useState, useEffect } from 'react';
import { FaCog, FaFileImport, FaDatabase, FaCheckCircle, FaTimes } from 'react-icons/fa';

import { useIngestion } from '@/hooks/useIngestion';
import BaseModal from './BaseModal';
import DataPathStep from './setup/DataPathStep';
import ImportStep from './setup/ImportStep';
import ScanStep from './setup/ScanStep';

import styles from '@/components/modals/SetupModal.module.css';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
  initialStep?: number;
  isFirstRun?: boolean;
}

export default function SetupModal({
  isOpen,
  onClose,
  onCompleted,
  initialStep = 0,
  isFirstRun = false,
}: SetupModalProps) {
  const steps: ('path' | 'import' | 'scan')[] = isFirstRun ? ['path', 'import', 'scan'] : ['scan', 'import', 'path'];

  const [activeTab, setActiveTab] = useState<'welcome' | 'path' | 'import' | 'scan'>(() => {
    if (isFirstRun) {
      return 'welcome';
    }
    if (initialStep === 1) {
      return 'import';
    }
    if (initialStep === 2) {
      return 'scan';
    }
    return 'path';
  });
  const [prevOpen, setPrevOpen] = useState(isOpen);

  // Sync tab when modal re-opens (Adjusting state during rendering pattern)
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    const stepTab = initialStep === 0 ? 'welcome' : initialStep === 1 ? 'import' : initialStep === 2 ? 'scan' : 'path';
    setActiveTab(stepTab);
  } else if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  // Configuration State
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const [remoteFiles, setRemoteFiles] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');
  const [isExistingWorkspace, setIsExistingWorkspace] = useState(false);
  const [hasExistingArchives, setHasExistingArchives] = useState(false);

  const handleUpdateWorkspacePath = (p: string | null) => {
    setWorkspacePath(p);
    setPathError(null);
  };

  // Ingestion Hook
  const {
    isInstalling,
    isComplete,
    logs,
    status,
    progress,
    error,
    activeTransfers,
    runInstall: startIngestion,
  } = useIngestion();

  // Side-effect: Load config on open
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    (async () => {
      try {
        const response = await fetch('/api/setup/config');
        const data = await response.json();
        setWorkspacePath(data.workspacePath);
        setResolvedPath(data.resolved);
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    })();
  }, [isOpen]);

  const isPathTab = activeTab === 'path';
  const isScanTab = activeTab === 'scan';
  const isFastFinish = isPathTab && isFirstRun && isExistingWorkspace;
  const isFullyDone = isComplete || (isScanTab && remoteFiles.length === 0 && !hasExistingArchives);

  // Background Finalization: Automatic finalization when first-run ingestion completes.
  useEffect(() => {
    if (!isFirstRun || !isFullyDone || !isOpen) {
      return;
    }

    (async () => {
      try {
        await fetch('/api/setup/finalize', { method: 'POST' });
      } catch (e) {
        console.error('Background finalization failed:', e);
      }
    })();
  }, [isFullyDone, isFirstRun, isOpen]);

  const saveConfig = async () => {
    try {
      setPathError(null);
      const configRes = await fetch('/api/setup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspacePath ?? resolvedPath, create: true }),
      });
      const data = await configRes.json();
      if (configRes.ok) {
        setWorkspacePath(data.workspacePath);
        setResolvedPath(data.resolved);

        // First-run configuration does not trigger immediate finalization or refresh.
        if (isFirstRun) {
          return;
        }

        // Settings mode: Finalize changes and reload when switching to an existing workspace.
        try {
          if (data.isExistingWorkspace) {
            await fetch('/api/setup/finalize', { method: 'POST' });
          }
          window.location.reload();
        } catch {
          setPathError('Network error finalizing workspace change');
        }
      } else {
        setPathError(data.error || 'Failed to update workspace');
        console.error('Error saving workspace path:', data.error);
      }
    } catch (e) {
      setPathError('Network error updating workspace');
      console.error('Network error saving workspace path', e);
    }
  };

  const handleRunInstall = () => {
    startIngestion(remoteFiles, transferMode);
  };

  const currentIndex = steps.indexOf(activeTab as 'path' | 'import' | 'scan');

  const handleNext = async () => {
    if (isInstalling) {
      return;
    }

    if (activeTab === 'welcome') {
      setActiveTab('path');
      return;
    }

    if (activeTab === 'path') {
      await saveConfig();

      if (isFirstRun) {
        // Validation check for first run
        if (!workspacePath && !resolvedPath) {
          return;
        }

        // Smart Skip: If existing workspace detected, finalize and finish now
        if (isExistingWorkspace) {
          try {
            const finalizeRes = await fetch('/api/setup/finalize', { method: 'POST' });
            if (finalizeRes.ok) {
              window.location.reload();
              return;
            }
          } catch (e) {
            console.error('Failed to auto-finalize existing workspace:', e);
          }
        }
      }
      setActiveTab('import');
      return;
    }

    if (activeTab === 'import') {
      setActiveTab('scan');
      return;
    }

    if (activeTab === 'scan') {
      if (isComplete) {
        onCompleted?.();
        onClose();
      }
      return;
    }

    if (currentIndex < steps.length - 1) {
      setActiveTab(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    if (currentIndex === 0) {
      setActiveTab('welcome');
    } else if (currentIndex > 0) {
      setActiveTab(steps[currentIndex - 1]);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'scan':
        return (
          <ScanStep
            runInstall={handleRunInstall}
            isInstalling={isInstalling}
            isComplete={isComplete}
            logs={logs}
            progress={progress}
            status={status}
            error={error}
            remoteFiles={remoteFiles}
            onGoToImport={() => setActiveTab('import')}
            onFinish={() => {
              onCompleted?.();
              onClose();
            }}
            onQueueUpdate={setHasExistingArchives}
            isFirstRun={isFirstRun}
            activeTransfers={activeTransfers}
          />
        );
      case 'import':
        return (
          <ImportStep
            isFirstRun={isFirstRun}
            setRemoteFiles={(files: string[]) => setRemoteFiles(files)}
            transferMode={transferMode}
            setTransferMode={setTransferMode}
            onConfirm={() => setActiveTab('scan')}
          />
        );
      case 'path':
        return (
          <DataPathStep
            dataPath={workspacePath}
            resolvedPath={resolvedPath}
            error={pathError}
            isInstalling={isInstalling}
            onChange={handleUpdateWorkspacePath}
            onSave={saveConfig}
            onExistingWorkspaceDetected={setIsExistingWorkspace}
            isFirstRun={isFirstRun}
          />
        );
      case 'welcome':
      default:
        return (
          <div className={styles.welcomeContainer}>
            <div className={styles.leftRail} />
            <div className={styles.welcomeContent}>
              <h1 className={styles.welcomeTitle}>Welcome to MessageHub</h1>
              <p className={styles.welcomeText}>
                Your personal message archive and indexer. Let&apos;s get started by setting up your workspace and
                importing your chats to build your private index.
              </p>
              <button className={`${styles.button} ${styles.bigButton}`} onClick={handleNext}>
                Get Started
              </button>
            </div>
          </div>
        );
    }
  };

  const renderFooter = () => {
    if (activeTab === 'welcome') {
      return null;
    }

    // Primary Button Configuration
    const getPrimaryButtonContent = () => {
      if (isScanTab) {
        if (isFullyDone) {
          return (
            <>
              <FaCheckCircle /> Open MessageHub
            </>
          );
        }
        if (isInstalling) {
          return 'Processing...';
        }
        return 'Start Processing';
      }

      if (activeTab === 'import' && remoteFiles.length === 0) {
        return 'Skip';
      }

      if (isFastFinish) {
        return 'Finish';
      }
      return 'Next';
    };

    const handlePrimaryAction = async () => {
      if (isScanTab) {
        if (isFullyDone) {
          if (isFirstRun) {
            // Finalize has already been called in the background useEffect,
            // or we call it one last time to be safe and reload.
            window.location.reload();
            return;
          }
          onCompleted?.();
          onClose();
        } else {
          handleRunInstall();
        }
      } else {
        handleNext();
      }
    };

    const isPrimaryDisabled = isScanTab ? isInstalling && !isComplete : isPathTab && !resolvedPath && !workspacePath;

    return (
      <div className={styles.wizardFooter}>
        <button className={styles.secondaryButton} disabled={isInstalling || isComplete} onClick={handleBack}>
          Back
        </button>

        <div className={styles.progressDots}>
          {!isFastFinish &&
            steps.map((step, idx) => (
              <div key={step} className={`${styles.dot} ${idx === currentIndex ? styles.dotActive : ''}`} />
            ))}
        </div>

        <button
          key={isScanTab ? 'btn-scan' : 'btn-next'}
          className={`${styles.button} ${isFullyDone ? styles.primaryButton : ''}`}
          onClick={handlePrimaryAction}
          disabled={isPrimaryDisabled}
          style={isScanTab ? { minWidth: 160 } : undefined}
        >
          {getPrimaryButtonContent()}
        </button>
      </div>
    );
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth={900}
      height="80vh"
      dismissible={false}
      className={styles.modal}
      overlayClassName={styles.overlay}
    >
      <div className={styles.setupContainerFull}>
        <button
          className={styles.closeButton}
          onClick={onClose}
          disabled={isInstalling}
          title="Close"
          aria-label="Close"
        >
          <FaTimes />
        </button>
        {isFirstRun ? (
          <div className={styles.wizardLayout}>
            <div
              key={activeTab}
              className={`${styles.wizardContent} ${activeTab === 'welcome' ? styles.wizardContentWelcome : ''}`}
            >
              {renderContent()}
            </div>
            {renderFooter()}
          </div>
        ) : (
          <div className={styles.setupContainer}>
            {/* Sidebar */}
            <div className={styles.sidebar}>
              <div className={styles.sidebarTitle}>
                <span className={styles.sidebarTitleEmoji}>⚙️</span> Setup
              </div>

              {steps.map((step) => (
                <div
                  key={step}
                  className={`${styles.sidebarItem} ${activeTab === step ? styles.sidebarActive : ''}`}
                  onClick={() => setActiveTab(step)}
                >
                  <div className={styles.sidebarIconWrapper}>
                    {step === 'scan' && <FaDatabase />}
                    {step === 'import' && <FaFileImport />}
                    {step === 'path' && <FaCog />}
                  </div>
                  <span style={{ textTransform: 'capitalize', flex: 1 }}>
                    {step === 'scan' ? 'Overview' : step === 'path' ? 'Workspace' : step}
                  </span>
                  {step === 'scan' && remoteFiles.length > 0 && (
                    <span className={styles.sidebarBadge}>{remoteFiles.length}</span>
                  )}
                </div>
              ))}

              <div className={styles.sidebarFooter}>
                <button
                  onClick={() => {
                    if (isComplete) {
                      onCompleted?.();
                    }
                    onClose();
                  }}
                  disabled={isInstalling}
                  className={`${styles.secondaryButton} ${styles.sidebarCloseBtn}`}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Main Content */}
            <div className={styles.sidebarContent}>{renderContent()}</div>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
