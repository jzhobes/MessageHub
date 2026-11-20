import React, { useState } from 'react';

import { FaDatabase, FaShieldAlt, FaTrashAlt } from 'react-icons/fa';
import { FaTriangleExclamation } from 'react-icons/fa6';

import FileExplorer, { formatBytes } from '@/components/FileExplorer';
import styles from '@/components/modals/SetupModal.module.css';
import Tooltip from '@/components/Tooltip';

import type { ArchiveMode } from '@/hooks/useIngestion';

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
  archiveMode: ArchiveMode;
  setRemoteFiles: (files: string[], totalSize: number) => void;
  setArchiveMode: (m: ArchiveMode) => void;
  onConfirm?: () => void;
}

export default function ImportStep({
  isFirstRun,
  archiveMode,
  setRemoteFiles,
  setArchiveMode,
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
          height="100%"
          addressBarSuffix={
            !isFirstRun && (
              <Tooltip
                content="Proceed to overview to start processing"
                align="end"
                style={{ height: '100%', borderRadius: 'inherit' }}
              >
                <button
                  className={`${styles.button} ${styles.explorerActionBtn}`}
                  disabled={selectionCount === 0}
                  onClick={onConfirm}
                >
                  <FaDatabase size={16} />
                  Confirm
                </button>
              </Tooltip>
            )
          }
          subheader={
            <div className={styles.importActions}>
              <Tooltip content="Selected archive files remain intact after importing" align="start">
                <button
                  className={`${styles.actionButton} ${archiveMode === 'keep' ? styles.actionButtonActive : ''}`}
                  onClick={() => setArchiveMode('keep')}
                >
                  <FaShieldAlt size={12} />
                  Keep Originals
                </button>
              </Tooltip>
              <span className={styles.importSeparator}>|</span>
              <Tooltip content="Selected archive files are deleted after a successful import" align="start">
                <button
                  className={`${styles.actionButton} ${archiveMode === 'delete' ? styles.actionButtonActive : ''}`}
                  onClick={() => setArchiveMode('delete')}
                >
                  <FaTrashAlt size={12} />
                  Delete After Import
                </button>
              </Tooltip>
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
                {archiveMode === 'delete' ? (
                  <span style={{ display: 'flex' }}>
                    <FaTriangleExclamation color="#f59e0b" size={16} />
                    &nbsp;
                    <strong>Delete Mode:</strong>&nbsp;Selected archives will be&nbsp;<strong>deleted</strong>
                    &nbsp;after a successful import
                  </span>
                ) : (
                  <>
                    <strong>Keep Mode:</strong> Selected archives will remain intact after importing
                  </>
                )}
              </div>
            </>
          )}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </div>
  );
}
