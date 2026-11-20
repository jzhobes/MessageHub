import React, { useCallback, useEffect, useRef, useState } from 'react';

import BaseModal, { BaseModalProps, ModalHeader } from '@/components/modals/BaseModal';
import ThreadNavigation from '@/components/ThreadNavigation';
import Tooltip from '@/components/Tooltip';

import { apiFetch } from '@/lib/client/apiClient';
import { getPlatformLabel } from '@/lib/shared/platforms';
import { ContentRecord, Thread } from '@/lib/shared/types';
import ThreadContent from '@/sections/ThreadContent';

import styles from './ThreadPreviewModal.module.css';

interface ThreadPreviewModalProps extends Pick<BaseModalProps, 'isOpen' | 'onClose' | 'onAfterClose'> {
  thread: Thread | null;
  selectionEnabled?: boolean;
  selectedDays?: Set<string>;
  dayStats?: Record<string, { totalMsgs: number; myMsgs: number }>;
  onToggleDay?: (dayKey: string) => void;
  onClearDays?: () => void;
}

function formatShortChipDate(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) {
    return dayKey;
  }
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ThreadPreviewModal({
  isOpen,
  thread,
  selectionEnabled = false,
  selectedDays,
  dayStats,
  onToggleDay,
  onClearDays,
  onClose,
  onAfterClose,
}: ThreadPreviewModalProps) {
  // Use the same ChatWindow state as the home page.
  const [messages, setMessages] = useState<ContentRecord[] | null>(null);
  const [chipJumpError, setChipJumpError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [visibleTimestamp, setVisibleTimestamp] = useState<number | undefined>();
  const [visiblePage, setVisiblePage] = useState(1);
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);
  const [targetTimestamp, setTargetTimestamp] = useState<number | null>(null);
  const [timelineReset, setTimelineReset] = useState(0);
  const [highlightToken, setHighlightToken] = useState(0);

  const threadId = thread?.id;
  const threadPlatform = thread?.platform || '';
  const totalPages = thread?.messageCount ? Math.ceil(thread.messageCount / 100) : 1;
  const isEventThread = !!threadId?.startsWith('fb-event-');
  const showSelectionUI = selectionEnabled && !isEventThread && !!onToggleDay;

  // Keep track of the latest request so older responses can't replace it.
  const latestRequestRef = useRef<symbol | null>(null);

  const openKey = isOpen && threadId ? threadId : null;
  const [prevOpenKey, setPrevOpenKey] = useState<string | null>(null);
  if (openKey !== prevOpenKey) {
    setPrevOpenKey(openKey);
    setChipJumpError(null);
    if (openKey) {
      setVisiblePage(1);
      setVisibleTimestamp(undefined);
      setMessages(null);
      setHasMoreOld(false);
      setHasMoreNew(false);
      setPageRange({ min: 1, max: 1 });
      setTargetTimestamp(null);
      setHighlightToken(0);
      setTimelineReset((value) => value + 1);
    }
  }

  const loadMessages = useCallback(
    async (tid: string, pageNum: number, mode: 'older' | 'newer') => {
      const requestId = Symbol('loadMessages');
      latestRequestRef.current = requestId;

      setLoading(true);

      try {
        const res = await apiFetch(
          `/api/content?threadId=${encodeURIComponent(tid)}&page=${pageNum}&platform=${encodeURIComponent(
            threadPlatform,
          )}`,
        );

        if (latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.records || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          if (mode === 'older') {
            setMessages((prev) => [...(prev || []), ...newMsgs]);
            setHasMoreOld(hasData && isFullPage);
            setPageRange((prev) => ({ ...prev, max: pageNum }));
          } else {
            setMessages((prev) => [...newMsgs, ...(prev || [])]);
            setHasMoreNew(pageNum > 1);
            setPageRange((prev) => ({ ...prev, min: pageNum }));
          }
        } else {
          if (mode === 'older') {
            setHasMoreOld(false);
          } else {
            setHasMoreNew(false);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [threadPlatform],
  );

  // Initialize on open
  useEffect(() => {
    const activeId = threadId;
    if (!isOpen || !activeId) {
      return;
    }

    const controller = new AbortController();
    const requestId = Symbol('loadMessages');
    latestRequestRef.current = requestId;

    async function fetchInitial() {
      try {
        const res = await apiFetch(
          `/api/content?threadId=${encodeURIComponent(activeId!)}&page=1&platform=${encodeURIComponent(
            threadPlatform,
          )}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted || latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          if (controller.signal.aborted || latestRequestRef.current !== requestId) {
            return;
          }
          const newMsgs = data.records || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          setMessages(newMsgs);
          // Start the preview at page 1.
          setHasMoreOld(hasData && isFullPage);
          setHasMoreNew(false);
          setPageRange({ min: 1, max: 1 });
        } else {
          setMessages([]);
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return;
        }
        console.error(e);
        if (latestRequestRef.current === requestId) {
          setMessages([]);
        }
      } finally {
        if (!controller.signal.aborted && latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    fetchInitial();

    return () => {
      controller.abort();
    };
  }, [isOpen, threadId, threadPlatform]);

  const handleLoadOld = () => {
    if (!thread?.id) {
      return;
    }
    const next = pageRange.max + 1;
    loadMessages(thread.id, next, 'older');
  };

  const handleLoadNew = () => {
    if (!thread?.id) {
      return;
    }
    const next = pageRange.min - 1;
    if (next < 1) {
      return;
    }
    loadMessages(thread.id, next, 'newer');
  };

  const loadJumpTarget = useCallback(
    async (resolveTarget: () => Promise<{ page: number; timestamp?: number }>, onError?: (error: unknown) => void) => {
      if (!threadId) {
        return;
      }
      setChipJumpError(null);
      const requestId = Symbol('jump');
      latestRequestRef.current = requestId;
      setLoading(true);

      try {
        const { page, timestamp } = await resolveTarget();
        if (latestRequestRef.current !== requestId) {
          return;
        }

        const contentRes = await apiFetch(
          `/api/content?threadId=${encodeURIComponent(threadId)}&page=${page}&platform=${encodeURIComponent(threadPlatform)}`,
        );
        if (latestRequestRef.current !== requestId) {
          return;
        }
        if (!contentRes.ok) {
          throw new Error('Unable to load messages.');
        }
        const data = await contentRes.json();
        if (latestRequestRef.current !== requestId) {
          return;
        }
        const newMsgs = data.records || [];
        const isFullPage = newMsgs.length >= 100;
        setMessages(newMsgs);
        setPageRange({ min: page, max: page });
        setVisiblePage(page);
        setHasMoreOld(newMsgs.length > 0 && isFullPage);
        setHasMoreNew(page > 1);
        setTargetTimestamp(timestamp ?? null);
        setTimelineReset((value) => value + 1);
        if (timestamp != null) {
          setHighlightToken((prev) => prev + 1);
        }
      } catch (error) {
        if (latestRequestRef.current !== requestId) {
          return;
        }
        if (!onError) {
          throw error;
        }
        onError(error);
      } finally {
        if (latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [threadId, threadPlatform],
  );

  const navigateToPage = (page: number, timestamp?: number) => loadJumpTarget(async () => ({ page, timestamp }));

  const handleJumpToDate = (date: string) => {
    if (!threadId) {
      return;
    }
    return loadJumpTarget(
      async () => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const response = await apiFetch(`/api/jump?${new URLSearchParams({ threadId, date, timeZone })}`);
        if (!response.ok) {
          throw new Error('Unable to find messages for this date.');
        }
        return response.json();
      },
      (error) => setChipJumpError(error instanceof Error ? error.message : 'Unable to jump to this date.'),
    );
  };

  const sortedSelectedDays = selectedDays ? Array.from(selectedDays).sort().reverse() : [];
  const selectedMsgCount = sortedSelectedDays.reduce((sum, d) => sum + (dayStats?.[d]?.totalMsgs || 0), 0);

  return (
    <BaseModal
      isOpen={isOpen}
      maxWidth={900}
      height="85vh"
      onClose={onClose}
      onAfterClose={() => {
        setMessages(null);
        onAfterClose?.();
      }}
    >
      <ModalHeader onClose={onClose}>
        <h2 className={styles.threadTitle}>{thread?.title || 'Thread Preview'}</h2>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          {thread?.platform && getPlatformLabel(thread.platform)}
        </div>
      </ModalHeader>
      {(showSelectionUI || threadId) && (
        <div className={styles.selectionBar}>
          {showSelectionUI && (
            <div className={styles.selectionSummary}>
              <span className={styles.selectionCount}>
                {sortedSelectedDays.length > 0
                  ? `${sortedSelectedDays.length} ${sortedSelectedDays.length === 1 ? 'day' : 'days'} · ${selectedMsgCount.toLocaleString()} msgs`
                  : 'No days selected'}
              </span>
              {sortedSelectedDays.length > 0 && (
                <div className={styles.chipList}>
                  {sortedSelectedDays.map((dayKey) => (
                    <span key={dayKey} className={styles.dayChip}>
                      <Tooltip content={`Jump to ${dayKey}`}>
                        <button
                          type="button"
                          className={styles.dayChipJump}
                          onClick={() => void handleJumpToDate(dayKey)}
                        >
                          {formatShortChipDate(dayKey)}
                        </button>
                      </Tooltip>
                      <button
                        type="button"
                        className={styles.dayChipRemove}
                        aria-label={`Remove ${dayKey}`}
                        onClick={() => onToggleDay?.(dayKey)}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  {onClearDays && (
                    <button type="button" className={styles.clearBtn} onClick={onClearDays}>
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {threadId && (
            <div className={styles.pageNavigation}>
              <ThreadNavigation
                key={threadId}
                threadId={threadId}
                currentPage={visiblePage}
                currentTimestamp={visibleTimestamp}
                totalPages={totalPages}
                onNavigate={navigateToPage}
              />
            </div>
          )}
        </div>
      )}
      {chipJumpError && (
        <p className={styles.jumpError} role="alert">
          {chipJumpError}
        </p>
      )}
      <div className={styles.messageList}>
        <ThreadContent
          activeThread={thread}
          messages={messages}
          loading={loading}
          hasMoreOld={hasMoreOld}
          hasMoreNew={hasMoreNew}
          pageRange={pageRange}
          targetMessageId={null}
          targetTimestamp={targetTimestamp}
          highlightToken={highlightToken}
          timelineReset={timelineReset}
          initializing={loading && messages === null}
          selectedDays={showSelectionUI ? selectedDays : undefined}
          dayStats={showSelectionUI ? dayStats : undefined}
          hideHeader
          onToggleDay={showSelectionUI ? onToggleDay : undefined}
          onStartReached={handleLoadOld}
          onEndReached={handleLoadNew}
          onPageChange={(page, timestamp) => {
            setVisiblePage(page);
            setVisibleTimestamp(timestamp);
          }}
        />
      </div>
    </BaseModal>
  );
}
