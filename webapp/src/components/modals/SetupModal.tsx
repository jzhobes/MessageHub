import React, { useEffect, useState } from 'react';

import { FaCheckCircle, FaCog, FaDatabase, FaFileImport, FaTimes } from 'react-icons/fa';

import BaseModal from '@/components/modals/BaseModal';
import DataPathStep from '@/components/modals/setup/DataPathStep';
import ImportStep from '@/components/modals/setup/ImportStep';
import ScanStep from '@/components/modals/setup/ScanStep';
import Tooltip from '@/components/Tooltip';

import { ArchiveMode, useIngestion } from '@/hooks/useIngestion';

import styles from './SetupModal.module.css';

interface SetupModalProps {
  isOpen: boolean;
  initialStep?: number;
  isFirstRun?: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

const TAB_MAP: Record<number, 'path' | 'import' | 'scan'> = {
  1: 'import',
  2: 'scan',
  3: 'path',
};

export default function SetupModal({
  isOpen,
  initialStep = 0,
  isFirstRun = false,
  onClose,
  onCompleted,
}: SetupModalProps) {
  const steps: ('path' | 'import' | 'scan')[] = isFirstRun ? ['path', 'import', 'scan'] : ['scan', 'import', 'path'];

  const [activeTab, setActiveTab] = useState<'welcome' | 'path' | 'import' | 'scan'>(
    () => TAB_MAP[initialStep] || (isFirstRun ? 'welcome' : 'path'),
  );
  const [prevOpen, setPrevOpen] = useState(isOpen);

  // Pick up the new tab during render when the modal reopens.
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    setActiveTab(TAB_MAP[initialStep] || (isFirstRun ? 'welcome' : 'path'));
  } else if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  // Configuration State
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const [remoteFiles, setRemoteFiles] = useState<string[]>([]);
  const [archiveMode, setArchiveMode] = useState<ArchiveMode>('keep');
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
    reset: resetIngestion,
  } = useIngestion();

  const handleClose = () => {
    if (!isInstalling) {
      resetIngestion();
      setRemoteFiles([]);
    }
    onClose();
  };

  const handleSetRemoteFiles = (files: string[]) => {
    setRemoteFiles(files);
    if (files.length > 0 && !isInstalling && (isComplete || error)) {
      resetIngestion();
    }
  };

  // Switch to Scan when ingestion starts or we reconnect to it.
  useEffect(() => {
    if (isInstalling) {
      setActiveTab((prev) => (prev !== 'scan' ? 'scan' : prev)); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [isInstalling]);

  // Load the current config when the modal opens.
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

  // Finalize setup in the background when the first import finishes.
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

        // During first run, wait for ingestion before finalizing and refreshing.
        if (isFirstRun) {
          return true;
        }

        // In settings, switching to an existing workspace finalizes and reloads right away.
        try {
          if (data.isExistingWorkspace) {
            await fetch('/api/setup/finalize', { method: 'POST' });
          }
          window.location.reload();
          return true;
        } catch {
          setPathError('Network error finalizing workspace change');
          return false;
        }
      } else {
        setPathError(data.error || 'Failed to update workspace');
        console.error('Error saving workspace path:', data.error);
        return false;
      }
    } catch (e) {
      setPathError('Network error updating workspace');
      console.error('Network error saving workspace path', e);
      return false;
    }
  };

  const handleRunInstall = () => {
    startIngestion(remoteFiles, archiveMode);
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
      const saved = await saveConfig();
      if (!saved) {
        return;
      }

      if (isFirstRun) {
        // Validation check for first run
        if (!workspacePath && !resolvedPath) {
          return;
        }

        // If the workspace already exists, finish setup now.
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
        handleClose();
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
            isFirstRun={isFirstRun}
            activeTransfers={activeTransfers}
            onGoToImport={() => setActiveTab('import')}
            onFinish={() => {
              onCompleted?.();
              handleClose();
            }}
            onQueueUpdate={setHasExistingArchives}
          />
        );
      case 'import':
        return (
          <ImportStep
            isFirstRun={isFirstRun}
            setRemoteFiles={handleSetRemoteFiles}
            archiveMode={archiveMode}
            setArchiveMode={setArchiveMode}
            onConfirm={() => {
              if (!isInstalling && (isComplete || error)) {
                resetIngestion();
              }
              setActiveTab('scan');
            }}
          />
        );
      case 'path':
        return (
          <DataPathStep
            dataPath={workspacePath}
            resolvedPath={resolvedPath}
            error={pathError}
            isInstalling={isInstalling}
            isFirstRun={isFirstRun}
            onChange={handleUpdateWorkspacePath}
            onSave={saveConfig}
            onExistingWorkspaceDetected={setIsExistingWorkspace}
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
            // The background effect may have finalized already.
            // If it hasn't, finalize here before reloading.
            window.location.reload();
            return;
          }
          onCompleted?.();
          handleClose();
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
          disabled={isPrimaryDisabled}
          style={isScanTab ? { minWidth: 160 } : undefined}
          onClick={handlePrimaryAction}
        >
          {getPrimaryButtonContent()}
        </button>
      </div>
    );
  };

  return (
    <BaseModal
      isOpen={isOpen}
      maxWidth={900}
      height="80vh"
      dismissible={false}
      className={styles.modal}
      onClose={handleClose}
    >
      <div className={styles.setupContainerFull}>
        {!isFirstRun && (
          <Tooltip content="Close" align="end" className={styles.closeButtonTooltip}>
            <button className={styles.closeButton} disabled={isInstalling} aria-label="Close" onClick={handleClose}>
              <FaTimes />
            </button>
          </Tooltip>
        )}
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
                <button
                  key={step}
                  className={`${styles.sidebarItem} ${activeTab === step ? styles.sidebarActive : ''}`}
                  disabled={isInstalling}
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
                  {step === 'scan' && !isComplete && remoteFiles.length > 0 && (
                    <span className={styles.sidebarBadge}>{remoteFiles.length}</span>
                  )}
                </button>
              ))}

              <div className={styles.sidebarFooter}>
                <button
                  disabled={isInstalling}
                  className={`${styles.secondaryButton} ${styles.sidebarCloseBtn}`}
                  onClick={() => {
                    if (isComplete) {
                      onCompleted?.();
                    }
                    handleClose();
                  }}
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
