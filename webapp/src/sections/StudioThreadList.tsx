import React, { useEffect, useRef } from 'react';
import { FaSpinner } from 'react-icons/fa';
import { Thread } from '@/lib/shared/types';
import styles from '@/pages/studio.module.css';

interface StudioThreadListProps {
  loading: boolean;
  threads: Thread[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  onPreview: (id: string) => void;
}

export const StudioThreadList: React.FC<StudioThreadListProps> = ({ loading, threads, selectedIds, onChange, onPreview }) => {
  const lastCheckedId = useRef<string | null>(null);
  const rangeStartId = useRef<string | null>(null);
  const rangeBase = useRef<Set<string>>(new Set());
  const shiftDown = useRef(false);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') {
        shiftDown.current = true;
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') {
        shiftDown.current = false;
        rangeStartId.current = null;
        rangeBase.current = new Set();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleToggle = (id: string) => {
    const clickedIndex = threads.findIndex((t) => t.id === id);
    if (clickedIndex === -1) {
      return;
    }

    const isShift = shiftDown.current;
    // Ensure a starting point for shift range if an anchor exists
    if (isShift && !rangeStartId.current && lastCheckedId.current) {
      rangeStartId.current = lastCheckedId.current;
    }

    // Start a new shift gesture if shift is down but we don't have a rangeStart yet.
    // Base should be the CURRENT selection at the moment the gesture starts.
    if (isShift && !rangeStartId.current) {
      rangeBase.current = new Set(selectedIds);

      // If no anchor yet (clean slate + shift held), treat first click as normal toggle,
      // and set rangeStart to this item.
      if (!lastCheckedId.current) {
        const next = new Set(selectedIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }

        onChange(next);
        lastCheckedId.current = id;
        rangeStartId.current = id;

        // Base becomes the result of this first click
        rangeBase.current = new Set(next);
        return;
      }

      // If an anchor exists, start range from anchor
      rangeStartId.current = lastCheckedId.current;
    }

    // Shift range apply (rolling base + moving start)
    if (isShift && rangeStartId.current) {
      const startIndex = threads.findIndex((t) => t.id === rangeStartId.current);
      if (startIndex === -1) {
        return;
      }

      const from = Math.min(startIndex, clickedIndex);
      const to = Math.max(startIndex, clickedIndex);

      // Intent is driven by the clicked item's current state
      const shouldSelect = !selectedIds.has(id);

      // IMPORTANT: build from rangeBase (which updates each shift step), not a frozen anchor snapshot
      const next = new Set(rangeBase.current);

      for (let i = from; i <= to; i++) {
        const rid = threads[i].id;
        if (shouldSelect) {
          next.add(rid);
        } else {
          next.delete(rid);
        }
      }

      onChange(next);

      // Gmail-like: advance start and update base for the next shift click in the same gesture
      rangeStartId.current = id;
      rangeBase.current = new Set(next);

      return;
    }

    // Normal click: toggle + set anchor + reset shift gesture base
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    onChange(next);
    lastCheckedId.current = id;

    rangeStartId.current = null;
    rangeBase.current = new Set(next);
  };

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
                  handleToggle(t.id);
                }}
              />
              <div className={styles.threadInfo}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button type="button" className={styles.threadTitle} title={t.title} onClick={(e) => handlePreview(e, t.id)}>
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
};
