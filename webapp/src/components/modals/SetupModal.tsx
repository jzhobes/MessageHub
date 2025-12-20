import React, { useState, useEffect } from 'react';
import { FaCog, FaFileImport, FaDatabase } from 'react-icons/fa';

import BaseModal from './BaseModal';
import DataPathStep from './setup/DataPathStep';
import ImportStep from './setup/ImportStep';
import ScanStep from './setup/ScanStep';
import { useIngestion } from '@/hooks/useIngestion';

import styles from './SetupModal.module.css';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
  initialStep?: number;
}

export default function SetupModal({ isOpen, onClose, onCompleted, initialStep = 0 }: SetupModalProps) {
  const [activeTab, setActiveTab] = useState<'path' | 'import' | 'scan'>(
    initialStep === 1 ? 'import' : initialStep === 2 ? 'scan' : 'path',
  );
  const [prevOpen, setPrevOpen] = useState(isOpen);

  // Sync tab when modal re-opens (Adjusting state during rendering pattern)
  if (isOpen && !prevOpen) {
    setPrevOpen(true);
    const stepTab = initialStep === 1 ? 'import' : initialStep === 2 ? 'scan' : 'path';
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

        // Finalize immediately when switching workspaces via this button
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
        } catch (e) {
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
      <div className={styles.setupContainer}>
        {/* Sidebar */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarTitle}>
            <span className={styles.sidebarTitleEmoji}>⚙️</span> Setup
          </div>

          <div
            className={`${styles.sidebarItem} ${activeTab === 'scan' ? styles.sidebarActive : ''}`}
            onClick={() => setActiveTab('scan')}
          >
            <FaDatabase /> Overview
          </div>

          <div
            className={`${styles.sidebarItem} ${activeTab === 'import' ? styles.sidebarActive : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <FaFileImport /> Import Files
          </div>

          <div
            className={`${styles.sidebarItem} ${activeTab === 'path' ? styles.sidebarActive : ''}`}
            onClick={() => setActiveTab('path')}
          >
            <FaCog /> Workspace
          </div>

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
        <div className={styles.sidebarContent}>
          {activeTab === 'scan' && (
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
          )}

          {activeTab === 'import' && (
            <ImportStep setRemoteFiles={setRemoteFiles} transferMode={transferMode} setTransferMode={setTransferMode} />
          )}

          {activeTab === 'path' && (
            <DataPathStep
              dataPath={workspacePath}
              resolvedPath={resolvedPath}
              error={pathError}
              isInstalling={isInstalling}
              onChange={handleUpdateWorkspacePath}
              onSave={saveConfig}
            />
          )}
        </div>
      </div>
    </BaseModal>
  );
}
