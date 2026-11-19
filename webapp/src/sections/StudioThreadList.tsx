import React from 'react';

import { FaSpinner } from 'react-icons/fa';
import { Virtuoso } from 'react-virtuoso';

import Tooltip from '@/components/Tooltip';

import { useRangeSelection } from '@/hooks/useRangeSelection';

import { Thread } from '@/lib/shared/types';
import styles from '@/pages/studio.module.css';

interface StudioThreadListProps {
  loading: boolean;
  threads: Thread[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  onPreview: (id: string) => void;
  isProjectMode?: boolean;
  selectedDaysByThread?: Record<string, string[]>;
  dayStatsByThread?: Record<string, Record<string, { totalMsgs: number; myMsgs: number }>>;
  scanningThreadIds?: Set<string>;
}

export function StudioThreadList({
  loading,
  threads,
  selectedIds,
  onChange,
  onPreview,
  isProjectMode = false,
  selectedDaysByThread,
  dayStatsByThread,
  scanningThreadIds,
}: StudioThreadListProps) {
  const { handleSelection } = useRangeSelection({
    items: threads,
    selectedIds,
    onChange,
    getId: (t) => t.id,
  });

  function getScoreColor(score: number) {
    if (score >= 70) {
      return '#10b981';
    } // Green (High)
    if (score >= 40) {
      return '#f59e0b';
    } // Yellow (Med)
    return '#ef4444'; // Red (Low)
  }

  function handlePreview(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    onPreview(threadId);
  }

  return (
    <div className={styles.threadList}>
      {loading ? (
        <div className={styles.loadingContainer}>
          <FaSpinner className="spinner" size={24} />
          <span>Loading threads...</span>
        </div>
      ) : (
        <Virtuoso
          style={{ height: '100%' }}
          data={threads}
          itemContent={(index, t) => {
            const score = t.qualityScore || 0;
            const isSelected = selectedIds.has(t.id);
            const isScanning = isProjectMode && !!scanningThreadIds?.has(t.id);
            const selectedDays = selectedDaysByThread?.[t.id] || [];
            const statsMap = dayStatsByThread?.[t.id] || {};
            const selectedMsgCount = selectedDays.reduce((sum, d) => sum + (statsMap[d]?.totalMsgs || 0), 0);
            const isEventThread = t.id.startsWith('fb-event-');

            return (
              <div
                className={`${styles.threadItem} ${isSelected ? styles.selected : ''}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a, button, input')) {
                    return;
                  }
                  handleSelection(t.id);
                }}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleSelection(t.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className={styles.threadInfo}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className={styles.threadTitle}
                      title={t.title}
                      onClick={(e) => handlePreview(e, t.id)}
                    >
                      {t.title}
                    </button>
                    <Tooltip
                      align="start"
                      content={
                        <div>
                          <div className={styles.tooltipTitle}>Quality Score: {score}</div>
                          <div>Participation: {Math.round((t.participationRatio || 0) * 100)}%</div>
                          <div>Avg Msg Length: {t.myAvgMessageLength || 0} chars</div>
                          <div>My Messages: {(t.myMessageCount || 0).toLocaleString()}</div>
                        </div>
                      }
                    >
                      <div className={styles.qualityBadge} style={{ backgroundColor: getScoreColor(score) }}>
                        {score}
                      </div>
                    </Tooltip>
                  </div>
                  <div className={styles.threadMeta}>
                    <span>{t.platform_source || t.platform}</span>
                    {isProjectMode && isSelected && (
                      <Tooltip
                        align="start"
                        content={
                          isScanning ? (
                            'Scanning best representative days...'
                          ) : isEventThread ? (
                            'Events export as a full chronological timeline.'
                          ) : selectedDays.length > 0 ? (
                            <div>
                              <div className={styles.tooltipTitle}>Selected Days ({selectedDays.length})</div>
                              <div>{selectedDays.slice(0, 6).join(', ')}</div>
                              {selectedDays.length > 6 && <div>+{selectedDays.length - 6} more</div>}
                              <div className={styles.tooltipHint}>Click to review or adjust days</div>
                            </div>
                          ) : (
                            'No eligible days found in recency window. Click to pick manually.'
                          )
                        }
                      >
                        <button type="button" className={styles.daysBadge} onClick={(e) => handlePreview(e, t.id)}>
                          {isScanning
                            ? 'Scanning...'
                            : isEventThread
                              ? 'Timeline'
                              : selectedDays.length > 0
                                ? `${selectedDays.length}d · ${selectedMsgCount} msgs`
                                : '0 days'}
                        </button>
                      </Tooltip>
                    )}
                    <span>{new Date(t.timestamp).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
