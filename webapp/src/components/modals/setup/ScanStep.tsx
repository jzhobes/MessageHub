import React, { useEffect, useRef, useState } from 'react';

import { FaCheckCircle, FaDatabase, FaFileArchive, FaSync } from 'react-icons/fa';

import styles from '@/components/modals/SetupModal.module.css';

import { ArchiveProgress } from '@/hooks/useIngestion';

interface ScanStepProps {
  isFirstRun?: boolean;
  isInstalling: boolean;
  isComplete: boolean;
  logs: string[];
  progress: number;
  status: string;
  error: string | null;
  remoteFiles: string[];
  activeTransfers?: Record<string, ArchiveProgress>;
  runInstall: () => void;
  onGoToImport: () => void;
  onFinish: () => void;
  onQueueUpdate?: (hasItems: boolean) => void;
}

export default function ScanStep({
  isFirstRun,
  isInstalling,
  isComplete,
  logs,
  progress,
  status,
  error,
  remoteFiles,
  activeTransfers = {},
  runInstall,
  onGoToImport,
  onFinish,
  onQueueUpdate,
}: ScanStepProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [existingArchives, setExistingArchives] = useState<string[]>([]);

  useEffect(() => {
    onQueueUpdate?.(existingArchives.length > 0);
  }, [existingArchives, onQueueUpdate]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Fetch existing archives in Data Directory
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/setup/archives');
        const data = await response.json();
        if (data.archives) {
          setExistingArchives(data.archives);
        }
      } catch (err) {
        console.error('Failed to fetch existing archives:', err);
      }
    })();
  }, []);

  const activeArchiveList = Object.values(activeTransfers);

  return (
    <div className={styles.stepContainerFull}>
      <h2 className={styles.stepTitle}>Overview</h2>
      <p className={styles.stepDescription}>
        Process your selected imports and any existing archives in the Data Directory.
      </p>

      {!isInstalling && !isComplete && !error && (
        <div className={styles.stepMain}>
          <div className={styles.queueContainer}>
            <div className={styles.queueHeader}>
              <h4>Processing Queue</h4>
            </div>
            <div className={styles.consoleBox}>
              {existingArchives.length === 0 && remoteFiles.length === 0 ? (
                <div className={styles.queueEmptySection}>
                  <FaDatabase size={32} color="var(--text-secondary)" className={styles.dbIconEmpty} />
                  <p className={styles.spacingBottom20}>Your processing queue is empty.</p>
                  <button className={styles.secondaryButton} onClick={onGoToImport}>
                    Find Files to Import
                  </button>
                </div>
              ) : (
                <div className={styles.queueGroup}>
                  {remoteFiles.length > 0 && (
                    <div>
                      <div className={`${styles.queueGroupTitle} ${styles.queueGroupTitleNew}`}>
                        New Imports ({remoteFiles.length})
                      </div>
                      <ul className={styles.queueList}>
                        {remoteFiles.map((f, i) => (
                          <li key={`rf-${i}`} className={styles.queueListItem}>
                            {f.split('/').pop()}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {existingArchives.length > 0 && (
                    <div>
                      <div className={styles.queueGroupTitle}>Already in Workspace ({existingArchives.length})</div>
                      <ul className={styles.queueList}>
                        {existingArchives.map((f, i) => (
                          <li key={`ea-${i}`} className={styles.queueListItem}>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!(existingArchives.length === 0 && remoteFiles.length === 0) && (
            <div className={styles.actionCenter}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 'auto' }}>
                <FaDatabase size={20} color="var(--text-secondary)" />
                <span className={styles.actionStatusText}>Ready to build your index.</span>
              </div>
              {!isFirstRun && (
                <button className={`${styles.button} ${styles.bigButton}`} onClick={runInstall}>
                  Start Processing
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(isInstalling || isComplete || error) && (
        <div className={styles.stepMain}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{
                width: `${Math.max(5, progress)}%`,
                background: error ? '#ef4444' : undefined,
              }}
            />
          </div>
          <div className={styles.progressInfo}>
            <span className={styles.statusText}>{!isComplete && status}</span>
            <span className={styles.percentText}>{Math.round(progress)}%</span>
          </div>

          {/* Active Parallel Progress Bars */}
          {activeArchiveList.length > 0 && (
            <div className={styles.activeTransfersBox}>
              {activeArchiveList.map((archive) => (
                <FileProgressRow key={archive.name} archive={archive} />
              ))}
            </div>
          )}

          <div className={styles.consoleBox}>
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
            <div ref={logsEndRef} />
          </div>

          {error && (
            <div className={`${styles.completeBanner} ${styles.errorBanner}`}>
              <div className={styles.successText} style={{ color: '#ef4444' }}>
                <strong>Error:</strong> {error}
              </div>
              <button className={`${styles.button} ${styles.bigButton}`} onClick={runInstall}>
                Retry
              </button>
            </div>
          )}

          {isComplete && !isFirstRun && (
            <div className={styles.completeBanner}>
              <div className={styles.successText}>
                <FaCheckCircle />
                Complete!
              </div>
              <button className={`${styles.button} ${styles.bigButton}`} onClick={onFinish}>
                Done
              </button>
            </div>
          )}

          {isComplete && isFirstRun && (
            <div className={styles.completeBanner}>
              <div className={styles.successText}>
                <FaCheckCircle color="#22c55e" />
                Complete!
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileProgressRow({ archive }: { archive: ArchiveProgress }) {
  const pct = (archive.current / archive.total) * 100;
  const isConsolidating = archive.name.startsWith('Consolidating');

  return (
    <div className={styles.activeTransferItem}>
      <div className={styles.activeTransferHeader}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isConsolidating ? <FaSync size={14} className={styles.spinner} /> : <FaFileArchive size={16} />}
          <span
            style={{
              maxWidth: '300px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {archive.name}
          </span>
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
          {archive.current.toLocaleString()} / {archive.total.toLocaleString()} files
        </span>
      </div>
      <div className={styles.miniProgress}>
        <div className={styles.miniProgressFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
