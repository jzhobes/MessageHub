import React, { useState } from 'react';
import { FaFolder } from 'react-icons/fa';
import TextInput from '@/components/TextInput';
import FileExplorer from '@/components/FileExplorer';
import styles from '../SetupModal.module.css';

const WORKSPACE_SELECTION_FILE_FILTERS = [
  {
    pattern: '*',
    selectable: false,
  },
];

interface DataPathStepProps {
  dataPath: string;
  resolvedPath: string | null;
  onChange: (s: string) => void;
  onSave: () => void;
}

export default function DataPathStep({ dataPath, resolvedPath, onChange, onSave }: DataPathStepProps) {
  const [showExplorer, setShowExplorer] = useState(false);

  return (
    <div>
      <h2 className={styles.stepTitle}>Workspace Location</h2>
      <p className={styles.stepDescription}>Choose where this workspace&apos;s data and database will be stored.</p>
      <div className={`${styles.inputGroup} ${styles.spacingBottom20}`}>
        <TextInput
          autoFocus
          value={dataPath}
          onChange={(e) => onChange(e.target.value)}
          adornment={<FaFolder className={styles.adornmentIcon} />}
        />
        <button className={styles.secondaryButton} onClick={() => setShowExplorer(!showExplorer)}>
          Browse...
        </button>
      </div>
      {showExplorer && (
        <div className={styles.explorerContainer}>
          <FileExplorer
            mode="workspace"
            filters={WORKSPACE_SELECTION_FILE_FILTERS}
            allowSelectAll={false}
            onSelectionChange={() => {
              // Selection logic if needed in future
            }}
            actionPanel={
              <button className={`${styles.button} ${styles.explorerActionBtn}`} onClick={() => {}}>
                Set as Workspace Root
              </button>
            }
          />
        </div>
      )}

      <div className={styles.statusBox}>
        <strong>Current Status:</strong>{' '}
        {resolvedPath ? (
          <span className={styles.statusConnected}>Connected ({resolvedPath})</span>
        ) : (
          <span className={styles.statusDisconnected}>Not Connected</span>
        )}
        <div className={styles.statusDetail}>
          This location acts as the root for your current session. You can switch to a different workspace later by
          changing this path.
        </div>
      </div>

      <div className={styles.stepFooter}>
        <button className={styles.button} onClick={onSave}>
          Save & Update
        </button>
      </div>
    </div>
  );
}
