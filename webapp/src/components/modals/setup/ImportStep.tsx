import React, { useState } from 'react';
import { FaCopy, FaShare, FaDatabase } from 'react-icons/fa';

import FileExplorer, { formatBytes } from '@/components/FileExplorer';
import { FaTriangleExclamation } from 'react-icons/fa6';
import styles from '@/components/modals/SetupModal.module.css';

const IMPORT_ITEM_FILTERS = [
  {
    pattern: '*',
    visible: true,
    selectable: false,
  },
  ...['.zip', '.tgz', '.tar.gz'].map((ext) => ({
    pattern: `*${ext}`,
    visible: true,
    selectable: true,
  })),
];

interface ImportStepProps {
  isFirstRun?: boolean;
  setRemoteFiles: (files: string[], totalSize: number) => void;
  transferMode: 'copy' | 'move';
  setTransferMode: (m: 'copy' | 'move') => void;
  onConfirm?: () => void;
}

export default function ImportStep({
  isFirstRun,
  setRemoteFiles,
  transferMode,
  setTransferMode,
  onConfirm,
}: ImportStepProps) {
  const [selectionCount, setSelectionCount] = useState(0);

  function handleSelectionChange(files: string[], size: number) {
    setSelectionCount(files.length);
    setRemoteFiles(files, size);
  }

  return (
    <div className={styles.stepContainerFull}>
      <h2 className={styles.stepTitle}>Import Chats</h2>
      <p className={styles.stepDescription}>
        Select archive files (.zip, .tgz, .tar.gz) from standard exports (Facebook, Instagram, Google Takeout) to
        process.
      </p>

      <div className={styles.importExplorer}>
        <FileExplorer
          mode="import"
          filters={IMPORT_ITEM_FILTERS}
          onSelectionChange={handleSelectionChange}
          height="100%"
          addressBarSuffix={
            !isFirstRun && (
              <button
                className={`${styles.button} ${styles.explorerActionBtn}`}
                disabled={selectionCount === 0}
                onClick={onConfirm}
                title="Proceed to overview to start processing"
              >
                <FaDatabase size={16} />
                Confirm
              </button>
            )
          }
          subheader={
            <div className={styles.importActions}>
              <button
                onClick={() => setTransferMode('copy')}
                title="Preserve original files and copy them to the workspace"
                className={`${styles.actionButton} ${transferMode === 'copy' ? styles.actionButtonActive : ''}`}
              >
                <FaCopy size={12} />
                Copy
              </button>
              <span className={styles.importSeparator}>|</span>
              <button
                onClick={() => setTransferMode('move')}
                title="Move files to the workspace and remove them from the source location"
                className={`${styles.actionButton} ${transferMode === 'move' ? styles.actionButtonActive : ''}`}
              >
                <FaShare size={12} />
                Move
              </button>
            </div>
          }
          footer={({ visibleCount, selectedCount, totalSize }) => (
            <>
              <div className={styles.actionStatusText}>
                <span>{visibleCount} items</span>
                {selectedCount > 0 && (
                  <>
                    |
                    <span>
                      {selectedCount} selected ({formatBytes(totalSize)})
                    </span>
                  </>
                )}
              </div>
              <div className={styles.actionStatusText}>
                {transferMode === 'move' ? (
                  <span style={{ display: 'flex' }}>
                    <FaTriangleExclamation color="#f59e0b" size={16} />
                    &nbsp;
                    <strong>Move Mode:</strong>&nbsp;Original archives will be&nbsp;<strong>deleted</strong>
                  </span>
                ) : (
                  <>
                    <strong>Copy Mode:</strong> Originals will remain untouched
                  </>
                )}
              </div>
            </>
          )}
        />
      </div>
    </div>
  );
}
