import React, { useState, useEffect } from 'react';
import { FaCog, FaFileImport, FaDatabase, FaSpinner } from 'react-icons/fa';

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

  const handleUpdateWorkspacePath = (p: string | null) => {
    setWorkspacePath(p);
    setPathError(null);
  };

  // Ingestion Hook
  const { isInstalling, isComplete, logs, status, progress, error, runInstall: startIngestion } = useIngestion();

  // Side-effect: Load config on open
  useEffect(() => {
    if (isOpen) {
      fetch('/api/setup/config')
        .then((r) => r.json())
        .then((data) => {
          setWorkspacePath(data.workspacePath);
          setResolvedPath(data.resolved);
        });
    }
  }, [isOpen]);

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

        // Don't finalize and refresh on first run!
        if (isFirstRun) {
          return;
        }

        // Finalize immediately when switching workspaces via this button (Settings mode)
        try {
          const finalizeRes = await fetch('/api/setup/finalize', { method: 'POST' });
          if (finalizeRes.ok) {
            // Full refresh to ensure clean state with new workspace
            onCompleted?.();
            onClose();
          } else {
            const fData = await finalizeRes.json();
            setPathError(fData.error || 'Failed to finalize workspace change');
          }
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

  const [isSaving, setIsSaving] = useState(false);

  const handleRunInstall = () => {
    startIngestion(remoteFiles, transferMode);
  };

  const currentIndex = steps.indexOf(activeTab as 'path' | 'import' | 'scan');

  const handleNext = async () => {
    if (activeTab === 'welcome') {
      setActiveTab(steps[0]);
    } else if (activeTab === 'path') {
      setIsSaving(true);
      await saveConfig();
      setIsSaving(false);
      setActiveTab('import');
    } else if (currentIndex < steps.length - 1) {
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
          />
        );
      case 'import':
        return (
          <ImportStep
            isFirstRun={isFirstRun}
            setRemoteFiles={setRemoteFiles}
            transferMode={transferMode}
            setTransferMode={setTransferMode}
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
            onAdvance={() => setActiveTab('import')}
            onGoBack={() => setActiveTab('welcome')}
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
        {isFirstRun ? (
          <div className={styles.wizardLayout}>
            <div
              key={activeTab}
              className={`${styles.wizardContent} ${activeTab === 'welcome' ? styles.wizardContentWelcome : ''}`}
            >
              {renderContent()}
            </div>

            {activeTab !== 'welcome' && (
              <div className={styles.wizardFooter}>
                <button className={styles.secondaryButton} onClick={handleBack} disabled={isInstalling}>
                  Back
                </button>

                <div className={styles.progressDots}>
                  {steps.map((step, idx) => (
                    <div key={step} className={`${styles.dot} ${idx === currentIndex ? styles.dotActive : ''}`} />
                  ))}
                </div>

                {activeTab === 'scan' ? (
                  <button
                    className={styles.button}
                    onClick={() => {
                      if (isComplete) {
                        onCompleted?.();
                        onClose();
                      }
                    }}
                    disabled={isInstalling || !isComplete}
                  >
                    Finish
                  </button>
                ) : (
                  <button
                    className={styles.button}
                    onClick={handleNext}
                    disabled={isSaving || (activeTab === 'path' && !resolvedPath && !workspacePath)}
                  >
                    {isSaving ? (
                      <>
                        <FaSpinner className={styles.spinner} style={{ marginRight: 8 }} />
                        Saving...
                      </>
                    ) : (
                      'Next'
                    )}
                  </button>
                )}
              </div>
            )}
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
                  {step === 'scan' && <FaDatabase />}
                  {step === 'import' && <FaFileImport />}
                  {step === 'path' && <FaCog />}
                  <span style={{ textTransform: 'capitalize' }}>
                    {step === 'scan' ? 'Overview' : step === 'path' ? 'Workspace' : step}
                  </span>
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
