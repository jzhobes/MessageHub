import React, { useState, useEffect, useRef } from 'react';
import { FaDatabase, FaCheckCircle } from 'react-icons/fa';

import styles from '@/components/modals/SetupModal.module.css';

interface ScanStepProps {
  runInstall: () => void;
  isInstalling: boolean;
  isComplete: boolean;
  logs: string[];
  progress: number;
  status: string;
  error: string | null;
  remoteFiles: string[];
  onGoToImport: () => void;
  onFinish: () => void;
}

export default function ScanStep({
  runInstall,
  isInstalling,
  isComplete,
  logs,
  progress,
  status,
  error,
  remoteFiles,
  onGoToImport,
  onFinish,
}: ScanStepProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [existingArchives, setExistingArchives] = useState<string[]>([]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Fetch existing archives in Data Directory
  useEffect(() => {
    fetch('/api/setup/archives')
      .then((r) => r.json())
      .then((data) => {
        if (data.archives) {
          setExistingArchives(data.archives);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className={styles.stepContainerFull}>
      <h2 className={styles.stepTitle}>Overview</h2>
      <p className={styles.stepDescription}>
        Process selected files (and any existing files in the Data Directory) into the database.
      </p>

      {!isInstalling && !isComplete && !error && (
        <div className={styles.stepMain}>
          <div className={styles.queueContainer}>
            <div className={styles.queueHeader}>
              <h4>Processing Queue</h4>
            </div>
            <div className={styles.consoleBox}>
              {existingArchives.length === 0 && remoteFiles.length === 0 ? (
                <div className={styles.queueEmpty}>No archives found or selected.</div>
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

          {existingArchives.length === 0 && remoteFiles.length === 0 ? (
            <div className={styles.actionCenterEmpty}>
              <FaDatabase size={32} color="var(--text-secondary)" className={styles.dbIconEmpty} />
              <p className={styles.spacingBottom20}>No files found in workspace or queue.</p>
              <button
                className={`${styles.button} ${styles.bigButton} ${styles.bigButtonSecondary}`}
                onClick={onGoToImport}
              >
                Find Files to Import
              </button>
            </div>
          ) : (
            <div className={styles.actionCenter}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 'auto' }}>
                <FaDatabase size={20} color="var(--text-secondary)" />
                <span className={styles.actionStatusText}>Ready to build your index.</span>
              </div>
              <button onClick={runInstall} className={`${styles.button} ${styles.bigButton}`}>
                Start Processing
              </button>
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

          {isComplete && (
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
        </div>
      )}
    </div>
  );
}
