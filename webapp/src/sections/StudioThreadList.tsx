import React from 'react';
import { FaSpinner } from 'react-icons/fa';

import { useRangeSelection } from '@/hooks/useRangeSelection';
import { Thread } from '@/lib/shared/types';

import styles from '@/pages/studio.module.css';

interface StudioThreadListProps {
  loading: boolean;
  threads: Thread[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  onPreview: (id: string) => void;
}

export function StudioThreadList({ loading, threads, selectedIds, onChange, onPreview }: StudioThreadListProps) {
  const { handleSelection } = useRangeSelection({
    items: threads,
    selectedIds,
    onChange,
    getId: (t) => t.id,
  });

  const getScoreColor = (score: number) => {
    if (score >= 70) {
      return '#10b981';
    } // Green (High)
    if (score >= 40) {
      return '#f59e0b';
    } // Yellow (Med)
    return '#ef4444'; // Red (Low)
  };

  const handlePreview = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    onPreview(threadId);
  };

  return (
    <div className={styles.threadList}>
      {loading ? (
        <div className={styles.loadingContainer}>
          <FaSpinner className="spinner" size={24} />
          <span>Loading threads...</span>
        </div>
      ) : (
        threads.map((t) => {
          const score = t.qualityScore || 0;
          const tooltip = `Quality Score: ${score}\n\nParticipation: ${Math.round((t.participationRatio || 0) * 100)}%\nAvg Msg Length: ${t.myAvgMessageLength || 0} chars\nMy Messages: ${(t.myMessageCount || 0).toLocaleString()}`;
          let checkboxEl: HTMLInputElement | null = null;
          return (
            <div
              key={t.id}
              className={`${styles.threadItem} ${selectedIds.has(t.id) ? styles.selected : ''}`}
              onClick={(e) => {
                // Don’t hijack clicks on links, buttons, etc.
                if ((e.target as HTMLElement).closest('a, button, input')) {
                  return;
                }
                checkboxEl?.click();
              }}
            >
              <input
                ref={(el) => {
                  checkboxEl = el;
                }}
                type="checkbox"
                className={styles.checkbox}
                checked={selectedIds.has(t.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  handleSelection(t.id);
                }}
              />
              <div className={styles.threadInfo}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={styles.threadTitle}
                    title={t.title}
                    onClick={(e) => handlePreview(e, t.id)}
                  >
                    {t.title}
                  </button>
                  <div
                    title={tooltip}
                    style={{
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: 'white',
                      backgroundColor: getScoreColor(score),
                      padding: '2px 6px',
                      borderRadius: '10px',
                      minWidth: '24px',
                      textAlign: 'center',
                      cursor: 'help',
                    }}
                  >
                    {score}
                  </div>
                </div>
                <div className={styles.threadMeta}>
                  <span>{t.platform_source}</span>
                  <span>{new Date(t.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
