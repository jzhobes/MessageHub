import React, { useState } from 'react';
import { FaFolder, FaCheckCircle, FaExclamationCircle, FaExclamationTriangle } from 'react-icons/fa';

import FileExplorer from '@/components/FileExplorer';
import { PathMetadata } from '@/lib/shared/types';
import styles from '../SetupModal.module.css';

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
  isInstalling?: boolean;
  onChange: (s: string | null) => void;
  onSave: () => void;
}

const PathValidationStatus = ({
  metadata,
  serverError,
}: {
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
        <span>This is your current workspace.</span>
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
  isInstalling,
  onChange,
  onSave,
}: DataPathStepProps) {
  const [metadata, setMetadata] = useState<PathMetadata | null>(null);
  const [explorerError, setExplorerError] = useState<{ message: string; status?: number } | null>(null);

  const canUseLocation =
    !isInstalling &&
    (dataPath !== null || resolvedPath !== null) &&
    !explorerError &&
    !metadata?.isActive &&
    !metadata?.isNested &&
    (metadata?.exists ? metadata.isWritable : true);

  return (
    <div className={styles.stepContainerFull}>
      <h2 className={styles.stepTitle}>Workspace Location</h2>
      <p className={styles.stepDescription}>
        Change your workspace location by navigating to the folder where your database and messages should be stored.
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
                  <PathValidationStatus metadata={metadata} serverError={explorerError} />
                </div>
              )}
            </div>
          }
          addressBarSuffix={
            <button
              className={`${styles.button} ${styles.explorerActionBtn}`}
              onClick={onSave}
              disabled={!canUseLocation}
            >
              <FaFolder size={16} />
              Use This Location
            </button>
          }
          footer={
            <div className={styles.workspaceExplorerFooter}>
              <span className={styles.activeStatusLabel}>Current Workspace:</span>
              {resolvedPath ? (
                <span
                  className={styles.activeStatusPath}
                  onClick={() => onChange(resolvedPath)}
                  title="Click to navigate back to current workspace"
                >
                  {resolvedPath}
                </span>
              ) : (
                <span className={styles.activeStatusNone}>None (Setting Required)</span>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
