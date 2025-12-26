import React, { useEffect, useState } from 'react';
import {
  FaEyeSlash,
  FaFolder,
  FaCheckCircle,
  FaExclamationCircle,
  FaExclamationTriangle,
  FaReply,
  FaSpinner,
  FaTrash,
} from 'react-icons/fa';

import FileExplorer from '@/components/FileExplorer';
import TextInput from '@/components/TextInput';
import { PathMetadata } from '@/lib/shared/types';

import styles from '@/components/modals/SetupModal.module.css';

const WORKSPACE_SELECTION_FILE_FILTERS = [
  {
    pattern: '*',
    selectable: false,
  },
];

interface DataPathStepProps {
  dataPath: string | null;
  resolvedPath: string | null;
  error?: string | null;
  isFirstRun?: boolean;
  isInstalling?: boolean;
  onChange: (s: string | null) => void;
  onSave: () => void;
  onExistingWorkspaceDetected?: (isExisting: boolean) => void;
}

const PathValidationStatus = ({
  isFirstRun,
  metadata,
  serverError,
}: {
  isFirstRun?: boolean;
  metadata: PathMetadata | null;
  serverError: { message: string; status?: number } | null;
}) => {
  if (!metadata && !serverError) {
    return <div style={{ height: 24 }}>&nbsp;</div>;
  }

  // 1. Active Workspace (Highest Priority - Green)
  if (metadata?.isActive) {
    return (
      <div className={styles.validationRow}>
        <FaCheckCircle size={14} color="#22c55e" />
        <span>{isFirstRun ? 'Recommended default location.' : 'This is your current workspace.'}</span>
      </div>
    );
  }

  // 2. Nested Error (Highest Priority for Errors - Red)
  if (metadata?.isNested) {
    return (
      <div className={styles.validationRow}>
        <FaExclamationCircle size={14} color="#ef4444" />
        <span>This folder is inside an existing workspace.</span>
      </div>
    );
  }

  // 3. Permission Error (Red)
  if (serverError?.status === 403 || (metadata?.exists && !metadata?.isWritable)) {
    return (
      <div className={styles.validationRow}>
        <FaExclamationCircle size={14} color="#ef4444" />
        <span>Permission denied: App cannot write to this location.</span>
      </div>
    );
  }

  // 4. Not Found (Success for New - Green)
  if (serverError?.status === 404 || !metadata?.exists) {
    return (
      <div className={styles.validationRow}>
        <FaCheckCircle size={14} color="#22c55e" />
        <span>Folder doesn&apos;t exist yet. It will be created automatically.</span>
      </div>
    );
  }

  // 5. Existing Workspace (Signature detected - Green)
  if (metadata?.isExistingWorkspace) {
    return (
      <div className={styles.validationRow}>
        <FaCheckCircle size={14} color="#22c55e" />
        <span>Existing workspace detected. Ready to switch.</span>
      </div>
    );
  }

  // 6. Not Empty (Warning - Yellow)
  if (!metadata?.isEmpty) {
    return (
      <div className={styles.validationRow}>
        <FaExclamationTriangle size={14} color="#f59e0b" />
        <span>Folder is not empty. Existing files may be read or modified.</span>
      </div>
    );
  }

  // 7. Success (Existing Empty - Green)
  return (
    <div className={styles.validationRow}>
      <FaCheckCircle size={14} color="#22c55e" />
      <span>Valid workspace location.</span>
    </div>
  );
};

export default function DataPathStep({
  dataPath,
  resolvedPath,
  error,
  isFirstRun,
  isInstalling,
  onChange,
  onSave,
  onExistingWorkspaceDetected,
}: DataPathStepProps) {
  const [metadata, setMetadata] = useState<PathMetadata | null>(null);
  const [explorerError, setExplorerError] = useState<{ message: string; status?: number } | null>(null);
  const [resetConfirm, setResetConfirm] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [isResetComplete, setIsResetComplete] = useState(false);

  useEffect(() => {
    onExistingWorkspaceDetected?.(!!metadata?.isExistingWorkspace);
  }, [metadata?.isExistingWorkspace, onExistingWorkspaceDetected]);

  const canUseLocation =
    !isInstalling &&
    (dataPath !== null || resolvedPath !== null) &&
    !explorerError &&
    !metadata?.isActive &&
    !metadata?.isNested &&
    (metadata?.exists ? metadata.isWritable : true);

  const handleReset = async () => {
    if (resetConfirm !== 'RESET' || isResetting) {
      return;
    }

    setIsResetting(true);
    setResetError(null);

    try {
      const res = await fetch('/api/system/reset-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      });

      if (res.ok) {
        setIsResetComplete(true);
        setIsResetting(false);
      } else {
        const data = await res.json();
        setResetError(data.error || 'Failed to reset database');
        setIsResetting(false);
      }
    } catch {
      setResetError('Network error resetting database');
      setIsResetting(false);
    }
  };

  return (
    <div className={styles.stepContainerFull}>
      <h2 className={styles.stepTitle}>Workspace Location</h2>
      <p className={styles.stepDescription}>
        {isFirstRun ? 'Confirm' : 'Change'} your workspace location by navigating to the folder where your database and
        messages should be stored.
      </p>

      <div className={styles.explorerContainer}>
        <FileExplorer
          mode="workspace"
          initialPath={dataPath ?? resolvedPath ?? ''}
          filters={WORKSPACE_SELECTION_FILE_FILTERS}
          allowSelectAll={false}
          onPathChange={(p) => onChange(p)}
          onMetadataChange={setMetadata}
          onError={setExplorerError}
          height="100%"
          subheader={
            <div className={styles.subheaderRight}>
              {error ? (
                <div className={styles.errorBanner}>{error}</div>
              ) : (
                <div style={{ padding: '8px 0' }}>
                  <PathValidationStatus metadata={metadata} serverError={explorerError} isFirstRun={isFirstRun} />
                </div>
              )}
            </div>
          }
          addressBarSuffix={
            isFirstRun ? (
              <button
                className={`${styles.button} ${styles.explorerActionBtn}`}
                onClick={() => onChange(resolvedPath || '')}
                title="Revert to default location"
                disabled={(dataPath?.replace(/\/+$/, '') || '') === (resolvedPath?.replace(/\/+$/, '') || '')}
                style={{
                  opacity:
                    (dataPath?.replace(/\/+$/, '') || '') === (resolvedPath?.replace(/\/+$/, '') || '') ? 0.4 : 1,
                }}
              >
                <FaReply size={16} />
              </button>
            ) : (
              <button
                className={`${styles.button} ${styles.explorerActionBtn}`}
                onClick={onSave}
                disabled={!canUseLocation || isResetting}
              >
                <FaFolder size={16} />
                Use This Location
              </button>
            )
          }
          footer={
            <div className={styles.workspaceExplorerFooter}>
              {!isFirstRun ? (
                <>
                  {resolvedPath ? (
                    <>
                      <button className={styles.textLink} onClick={() => onChange(resolvedPath)}>
                        <FaReply size={10} style={{ marginRight: 4 }} /> Current Workspace
                      </button>
                      <button
                        className={`${styles.textLink} ${styles.textLinkDanger} ${showDangerZone ? styles.textLinkActive : ''}`}
                        onClick={() => setShowDangerZone(!showDangerZone)}
                      >
                        {showDangerZone ? (
                          <>
                            <FaEyeSlash size={12} style={{ marginRight: 4 }} /> Hide Wipe Options
                          </>
                        ) : (
                          <>
                            <FaTrash size={12} style={{ marginRight: 4, color: '#ef4444' }} /> Wipe Active Workspace
                          </>
                        )}
                      </button>
                    </>
                  ) : (
                    <span className={styles.activeStatusNone}>None (Setting Required)</span>
                  )}
                </>
              ) : (
                // Spacer to maintain footer height
                <div>&nbsp;</div>
              )}
            </div>
          }
        />
      </div>

      {!isFirstRun && showDangerZone && resolvedPath && (
        <div className={styles.dangerZone}>
          {!isResetComplete ? (
            <>
              <div className={styles.dangerTitle}>
                <FaTrash /> Danger Zone: Clear Data
              </div>
              <p className={styles.dangerDescription}>
                This will permanently delete the <strong>messagehub.db</strong> file and{' '}
                <strong>all data folders</strong> (Facebook, Instagram, Google Takeout, etc.) at:
                <code className={styles.dangerPath}>{resolvedPath}</code>
                Archive files <strong>outside of this workspace</strong> will not be touched.
              </p>

              <div className={styles.resetConfirmation}>
                <div className={styles.dangerActions}>
                  <TextInput
                    autoFocus
                    placeholder='Type "RESET" to confirm'
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    className={styles.resetInput}
                    disabled={isResetting}
                  />
                  <button
                    className={`${styles.button} ${styles.resetButton}`}
                    onClick={handleReset}
                    disabled={resetConfirm !== 'RESET' || isResetting}
                    style={{ flex: 1 }}
                  >
                    {isResetting ? (
                      <>
                        <FaSpinner className="spinner" color="#fff" /> Processing...
                      </>
                    ) : (
                      'Wipe This Workspace'
                    )}
                  </button>
                </div>
                {resetError && <div className={styles.errorBanner}>{resetError}</div>}
              </div>
            </>
          ) : (
            <div className={styles.resetSuccessView}>
              <div className={styles.successTitle}>
                <FaCheckCircle color="#22c55e" size={20} />
                <span>Workspace Successfully Reset</span>
              </div>
              <p className={styles.dangerDescription}>
                All database records and extracted files have been wiped. The application needs to reload to initialize
                your fresh workspace.
              </p>
              <div className={styles.successActions}>
                <button className={`${styles.button} ${styles.primaryButton}`} onClick={() => window.location.reload()}>
                  <FaCheckCircle /> Reload to Start Fresh
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
