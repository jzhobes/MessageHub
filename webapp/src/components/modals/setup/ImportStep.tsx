import React from 'react';
import { FaCopy, FaShare } from 'react-icons/fa';
import FileExplorer from '@/components/FileExplorer';
import styles from '../SetupModal.module.css';

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
  setRemoteFiles: (f: string[]) => void;
  transferMode: 'copy' | 'move';
  setTransferMode: (m: 'copy' | 'move') => void;
}

export default function ImportStep({ setRemoteFiles, transferMode, setTransferMode }: ImportStepProps) {
  return (
    <div className={styles.stepContainerFull}>
      <h2 className={styles.stepTitle}>Import Chats</h2>
      <p className={styles.stepDescription}>
        Select archive files (.zip, .tgz, .tar.gz) from standard exports (Facebook, Instagram, Google Takeout) to
        process. Selected files will be <strong>{transferMode === 'copy' ? 'copied' : 'moved'}</strong> to your
        workspace.
      </p>

      <div className={styles.importExplorer}>
        <FileExplorer
          mode="import"
          filters={IMPORT_ITEM_FILTERS}
          onSelectionChange={setRemoteFiles}
          height="100%"
          subheader={
            <div className={styles.importActions}>
              <button
                onClick={() => setTransferMode('copy')}
                title="Copy files to workspace (keep original)"
                className={`${styles.actionButton} ${transferMode === 'copy' ? styles.actionButtonActive : ''}`}
              >
                <FaCopy size={12} />
                Copy
              </button>
              <span className={styles.importSeparator}>|</span>
              <button
                onClick={() => setTransferMode('move')}
                title="Move files to workspace (delete original)"
                className={`${styles.actionButton} ${transferMode === 'move' ? styles.actionButtonActive : ''}`}
              >
                <FaShare size={12} />
                Move
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
