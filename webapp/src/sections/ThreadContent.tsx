import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FaChevronDown, FaImage, FaSpinner, FaUsers } from 'react-icons/fa';
import { IndexLocationWithAlign, Virtuoso, VirtuosoHandle } from 'react-virtuoso';

import { Dropdown, DropdownItem } from '@/components/Dropdown';
import EmailItem from '@/components/EmailItem';
import EventItem from '@/components/EventItem';
import MessageItem from '@/components/MessageItem';
import ThreadNavigation from '@/components/ThreadNavigation';

import { ContentRecord, QuotedMessageMetadata, Thread } from '@/lib/shared/types';

import styles from './ThreadContent.module.css';

const START_INDEX = 10000;

// Thread Header Dropdown Component
function ThreadHeaderDropdown({
  title,
  participants,
  showMedia,
  onShowMediaChange,
}: {
  title: string;
  participants: string[];
  showMedia?: boolean;
  onShowMediaChange?: (show: boolean) => void;
}) {
  const [showMembers, setShowMembers] = useState(false);

  return (
    <>
      <div className={styles.headerDropdownWrapper}>
        <Dropdown
          align="left"
          width="100%"
          className={styles.headerDropdown}
          menuClassName={styles.headerDropdownMenu}
          gap={0}
          trigger={
            <div className={styles.headerTitleButton}>
              <span className={styles.headerTitle}>{title}</span>
              <FaChevronDown size={12} />
            </div>
          }
        >
          <DropdownItem className={styles.headerDropdownItem} onClick={() => setShowMembers(true)}>
            <FaUsers size={14} />
            <span>Thread Members</span>
          </DropdownItem>
          {onShowMediaChange && (
            <DropdownItem className={styles.headerDropdownItem} onClick={() => onShowMediaChange(!showMedia)}>
              <FaImage size={14} />
              <span>Media</span>
            </DropdownItem>
          )}
        </Dropdown>
      </div>

      {/* Open the member list from the thread header. */}
      {showMembers && (
        <div className={styles.modalOverlay} onClick={() => setShowMembers(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Thread Members</h3>
              <button onClick={() => setShowMembers(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              {participants.length > 0 ? (
                <ul className={styles.participantsList}>
                  {participants.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p>No participants found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface ThreadContentProps {
  activeThread: Thread | null;
  messages: ContentRecord[] | null;
  loading: boolean;
  hasMoreOld: boolean;
  hasMoreNew: boolean;
  pageRange: { min: number; max: number };
  targetMessageId: string | null;
  targetTimestamp?: number | null;
  highlightToken: number;
  timelineReset: string | number;
  initializing?: boolean;
  hideHeader?: boolean;
  showMedia?: boolean;
  onStartReached: () => void;
  onEndReached: () => void;
  onNavigate?: (page: number, timestamp?: number) => Promise<void>;
  onPageChange?: (page: number, timestamp?: number) => void;
  onShowMediaChange?: (show: boolean) => void;
  selectedDays?: Set<string>;
  dayStats?: Record<string, { totalMsgs: number; myMsgs: number }>;
  onToggleDay?: (dayKey: string) => void;
}

/**
 * Display newest-first input in chronological order with `Virtuoso`. When older messages arrive,
 * decrease `firstItemIndex` from `START_INDEX` to keep the scroll position steady.
 * Wait 500ms before enabling edge pagination. Search jumps and quoted replies both scroll to and
 * highlight the target message.
 */
export default function ThreadContent({
  activeThread,
  messages,
  loading,
  hasMoreOld,
  hasMoreNew,
  pageRange,
  targetMessageId,
  targetTimestamp,
  highlightToken,
  timelineReset,
  initializing,
  hideHeader,
  showMedia,
  onStartReached,
  onEndReached,
  onPageChange,
  onNavigate,
  onShowMediaChange,
  selectedDays,
  dayStats,
  onToggleDay,
}: ThreadContentProps) {
  const threadId = activeThread?.id ?? null;
  const timelineKey = `${threadId ?? ''}:${timelineReset}`;
  const hasTimeline = messages !== null && !initializing;

  // Refs
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const previousMessagesLength = useRef(0);
  const newestMessageIdRef = useRef<string | null>(null);
  const atTopKeyRef = useRef<string | null>(null);
  const atBottomRef = useRef(false);
  const initialPreloadRef = useRef<string | null>(null);
  const initialPreloadSizeRef = useRef(0);
  const previousTimelineRef = useRef(timelineKey);

  // State
  const [currentTimestamp, setCurrentTimestamp] = useState<number | undefined>();
  const [currentTopPage, setCurrentTopPage] = useState(pageRange.min);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [isReady, setIsReady] = useState(false);
  const [localTargetId, setLocalTargetId] = useState<string | null>(null);
  const [localHighlightToken, setLocalHighlightToken] = useState(0);
  const [previousTimelineKey, setPreviousTimelineKey] = useState(timelineKey);

  if (timelineKey !== previousTimelineKey) {
    setPreviousTimelineKey(timelineKey);
    setCurrentTimestamp(undefined);
    setCurrentTopPage(pageRange.min);
    setFirstItemIndex(START_INDEX);
    setLocalTargetId(null);
    setIsReady(false);
  }

  // Memos (data)
  const virtuosoData = useMemo(() => {
    return messages ? [...messages].reverse() : [];
  }, [messages]);

  const targetIndex = useMemo(() => {
    if ((!targetMessageId && !targetTimestamp) || !virtuosoData.length) {
      return -1;
    }
    return virtuosoData.findIndex(
      (m) =>
        (!!targetMessageId && (m.id || m.timestamp_ms.toString()) === targetMessageId) ||
        (!!targetTimestamp && m.timestamp_ms === targetTimestamp),
    );
  }, [targetMessageId, targetTimestamp, virtuosoData]);

  const initialTopIndex = useMemo<IndexLocationWithAlign>(() => {
    if (targetIndex !== -1) {
      return { index: targetIndex, align: 'center' as const };
    }
    if (pageRange.min === 1) {
      return { index: 'LAST', align: 'end' as const };
    }
    // Virtuoso scroll locations are relative to the loaded data, even when firstItemIndex is set.
    return { index: 0, align: 'start' as const };
  }, [targetIndex, pageRange.min]);

  // Layout effects
  useLayoutEffect(() => {
    if (previousTimelineRef.current !== timelineKey) {
      previousTimelineRef.current = timelineKey;
      previousMessagesLength.current = 0;
      newestMessageIdRef.current = null;
    }

    if (!virtuosoData.length) {
      return;
    }

    const currentLen = virtuosoData.length;
    const prevLen = previousMessagesLength.current;

    if (currentLen > prevLen && prevLen > 0) {
      const currentNewest = virtuosoData[currentLen - 1];
      const currentNewestId = currentNewest.id || currentNewest.timestamp_ms.toString();

      // If the newest message stayed the same, the new rows are older history at the top.
      if (currentNewestId === newestMessageIdRef.current) {
        const delta = currentLen - prevLen;
        if (initialPreloadRef.current === timelineKey) {
          initialPreloadSizeRef.current = delta;
        }
        setFirstItemIndex((prev) => prev - delta);
        console.log(`[ChatWindow] Prepended ${delta} items. Adjusting index.`);
      } else {
        console.log(`[ChatWindow] Appended items (Future).`);
      }
    }

    // Update refs for next run
    previousMessagesLength.current = currentLen;
    if (virtuosoData.length > 0) {
      const last = virtuosoData[virtuosoData.length - 1];
      newestMessageIdRef.current = last.id || last.timestamp_ms.toString();
    }
  }, [virtuosoData, timelineKey]);

  // Effects

  // Reset atBottom on navigation so a stale value can't start a load loop.
  useEffect(() => {
    atBottomRef.current = false;
  }, [messages, targetMessageId]);

  // Ready state logic
  useEffect(() => {
    if (!hasTimeline) {
      return;
    }
    const t = setTimeout(() => {
      setIsReady(true);
    }, 500);
    return () => clearTimeout(t);
  }, [timelineKey, hasTimeline]);

  // Virtuoso can report an edge before pagination is ready and won't report it again for the same items.
  useEffect(() => {
    if (!isReady || loading) {
      return;
    }
    if (atTopKeyRef.current === timelineKey && hasMoreOld) {
      initialPreloadRef.current = timelineKey;
      onStartReached();
    } else if (atBottomRef.current && hasMoreNew) {
      onEndReached();
    }
    // Run only when the timeline becomes ready, so pagination updates cannot start a load loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  useEffect(() => {
    if (initialPreloadRef.current !== timelineKey || !initialPreloadSizeRef.current) {
      return;
    }
    // Keep the first message of the requested page at the top after preloading older rows.
    virtuosoRef.current?.scrollToIndex({ index: initialPreloadSizeRef.current, align: 'start' });
    initialPreloadRef.current = null;
    initialPreloadSizeRef.current = 0;
  }, [firstItemIndex, timelineKey]);

  // Scroll when highlightToken changes, even if the search result is in an already loaded thread.
  useEffect(() => {
    if (targetIndex !== -1 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: targetIndex,
        align: 'center',
        behavior: 'auto',
      });
    }
  }, [highlightToken, targetIndex]);

  // Callbacks
  const handleQuoteClick = useCallback(
    (quoteMetadata: QuotedMessageMetadata | undefined) => {
      if (!quoteMetadata) {
        return;
      }

      const matchIndex = virtuosoData.findIndex((m) => {
        const quoteName = quoteMetadata.creator?.name;
        return m.sender_name === quoteName && m.content === quoteMetadata.text;
      });

      if (matchIndex !== -1) {
        virtuosoRef.current?.scrollToIndex({
          index: matchIndex,
          align: 'center',
          behavior: 'auto',
        });
        const matchMsg = virtuosoData[matchIndex];
        const matchId = matchMsg.id || matchMsg.timestamp_ms.toString();
        setLocalTargetId(matchId);
        setLocalHighlightToken((prev) => prev + 1);
      } else {
        console.error('Message not found in loaded history');
      }
    },
    [virtuosoData],
  );

  const handleRangeChanged = (range: { startIndex: number; endIndex: number }) => {
    if (!messages || messages.length === 0) {
      return;
    }

    // Subtract Virtuoso's index offset to get the position in our array.
    const normalizedIndex = range.startIndex - firstItemIndex;

    // Safety check
    if (normalizedIndex < 0 || normalizedIndex >= messages.length) {
      return;
    }

    const originalIndex = messages.length - 1 - normalizedIndex;

    // Map original index to page number
    const calculatedPage = pageRange.min + Math.floor(originalIndex / 100);

    setCurrentTopPage(calculatedPage);
    const timestamp = messages[originalIndex]?.timestamp_ms;
    setCurrentTimestamp(timestamp);
    onPageChange?.(calculatedPage, timestamp);
  };

  // Components
  const Header = () => {
    return hasMoreOld || loading ? (
      <div className={styles.loadMoreContainer} style={{ padding: 20 }}>
        {loading && hasMoreOld && (
          <>
            <FaSpinner className="spinner" size={24} />
            <span className={styles.loadingText}>Loading older...</span>
          </>
        )}
      </div>
    ) : null;
  };

  const Footer = () => {
    return hasMoreNew || loading ? (
      <div className={styles.loadMoreContainer} style={{ padding: 20 }}>
        {loading && hasMoreNew && (
          <>
            <FaSpinner className="spinner" size={24} />
            <span className={styles.loadingText}>Loading newer...</span>
          </>
        )}
      </div>
    ) : activeThread?.platform === 'facebook' && activeThread.e2eeCutover ? (
      <div className={styles.cutoverNotice}>
        <p>Facebook Messenger switched this chat to end-to-end encryption.</p>
        <p>
          Messages after this point require a separate export.{' '}
          <a href="https://www.facebook.com/secure_storage/dyi" target="_blank" rel="noopener noreferrer">
            Download your encrypted Messenger messages.
          </a>
        </p>
      </div>
    ) : null;
  };

  // Render logic (conditionals)
  if (!activeThread && !initializing) {
    return (
      <div className={styles.contentArea}>
        <div className={styles.emptyState}>Select a thread</div>
      </div>
    );
  }

  if (initializing || messages === null) {
    return (
      <div className={styles.contentArea}>
        {!hideHeader && <div className={styles.contentHeader} />}
        <div className={styles.messagesContainer}>
          <div className={styles.emptyState}>
            <FaSpinner className="spinner" size={24} />
            <div className={styles.loadingText}>Loading messages...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.contentArea}>
      {!hideHeader && (
        <div className={styles.contentHeader}>
          <ThreadHeaderDropdown
            title={activeThread?.title || ''}
            participants={activeThread?.participants || []}
            showMedia={showMedia}
            onShowMediaChange={activeThread?.platform === 'google_mail' ? undefined : onShowMediaChange}
          />
          <div className={styles.pageIndicator}>
            {activeThread && onNavigate && (
              <ThreadNavigation
                key={activeThread.id}
                threadId={activeThread.id}
                currentPage={currentTopPage}
                currentTimestamp={currentTimestamp}
                firstMessageTimestamp={activeThread.firstMessageTimestamp}
                lastMessageTimestamp={activeThread.lastMessageTimestamp}
                totalPages={activeThread.pageCount || 1}
                onNavigate={onNavigate}
              />
            )}
          </div>
        </div>
      )}

      <div className={styles.messagesContainer}>
        <Virtuoso
          key={timelineKey}
          ref={virtuosoRef}
          data={virtuosoData}
          computeItemKey={(index, item) => (item.id ? item.id.toString() : `${item.timestamp_ms}-${index}`)}
          style={{ height: '100%' }}
          firstItemIndex={firstItemIndex}
          followOutput={false} // Don't pin the view to the bottom while new messages arrive.
          defaultItemHeight={50} // Give Virtuoso a starting estimate for item height.
          initialTopMostItemIndex={initialTopIndex}
          startReached={() => {
            if (hasMoreOld && !loading && isReady) {
              onStartReached();
            }
          }}
          endReached={() => {
            if (hasMoreNew && !loading && isReady) {
              onEndReached();
            }
          }}
          components={{
            Header,
            Footer,
          }}
          rangeChanged={handleRangeChanged}
          atTopStateChange={(atTop) => {
            atTopKeyRef.current = atTop ? timelineKey : null;
          }}
          atBottomStateChange={(atBottom) => {
            atBottomRef.current = atBottom;
          }}
          itemContent={(index, msg) => {
            // Determine if my message
            const dataIndex = index - firstItemIndex; // Convert Virtuoso's absolute index to the zero-based message index.

            const isMyMsg = !!msg.is_sender;
            const prevMsg = virtuosoData[dataIndex - 1]; // Above
            const nextMsg = virtuosoData[dataIndex + 1]; // Below

            // Add a day header for Studio Project mode when day selection is enabled.
            const currentDateObj = new Date(msg.timestamp_ms);
            const prevDateObj = prevMsg ? new Date(prevMsg.timestamp_ms) : null;
            const isDayChange =
              !prevDateObj ||
              currentDateObj.getDate() !== prevDateObj.getDate() ||
              currentDateObj.getMonth() !== prevDateObj.getMonth() ||
              currentDateObj.getFullYear() !== prevDateObj.getFullYear();

            const dayKey = `${currentDateObj.getFullYear()}-${String(currentDateObj.getMonth() + 1).padStart(
              2,
              '0',
            )}-${String(currentDateObj.getDate()).padStart(2, '0')}`;
            const dayHeaderLabel = currentDateObj.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            const showDayHeader = !!onToggleDay && isDayChange;
            const isDaySelected = !!selectedDays?.has(dayKey);
            const statsForDay = dayStats?.[dayKey];

            // Show a timestamp when the day changes or there's a gap over an hour.
            let showTimestamp = false;
            if (prevDateObj) {
              if (isDayChange || currentDateObj.getHours() !== prevDateObj.getHours()) {
                showTimestamp = true;
              }
            } else {
              showTimestamp = true;
            }

            // Start a bubble group when the sender changes or a timestamp breaks it up.
            const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name || showTimestamp;

            // End the group if the next sender changes or the next message needs a timestamp.
            // Look at the next message to see if it starts a new group.
            let nextShowsTimestamp = false;
            if (nextMsg) {
              const currentDate = new Date(msg.timestamp_ms);
              const nextDate = new Date(nextMsg.timestamp_ms);
              if (
                currentDate.getDate() !== nextDate.getDate() ||
                currentDate.getMonth() !== nextDate.getMonth() ||
                currentDate.getFullYear() !== nextDate.getFullYear() ||
                currentDate.getHours() !== nextDate.getHours()
              ) {
                nextShowsTimestamp = true;
              }
            }

            const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name || nextShowsTimestamp;

            // Pass the group flags and let MessageItem choose the styles.
            const showAvatar = !isMyMsg && isBottom;
            const showName = !isMyMsg && isTop;

            const msgId = msg.id || msg.timestamp_ms.toString();
            const isGlobalTarget =
              msgId === targetMessageId || (!!targetTimestamp && msg.timestamp_ms === targetTimestamp);
            const isLocalTarget = msgId === localTargetId;
            const isTarget = isGlobalTarget || isLocalTarget;
            const highlightKey = isGlobalTarget ? highlightToken : isLocalTarget ? localHighlightToken : 0;

            const timestampStr = new Date(msg.timestamp_ms).toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });

            const messageAlignStyle = msg?.is_sender ? styles.messageAlignRight : styles.messageAlignLeft;
            const classNames = [
              messageAlignStyle,
              isTop || !!prevMsg?.reactions?.length ? styles.firstMessage : null,
              isBottom || !!msg?.reactions?.length ? styles.lastMessage : null,
            ].filter(Boolean);

            const isEmail = activeThread?.platform === 'google_mail';
            const isEvent = activeThread?.id.startsWith('fb-event-');

            return (
              <div
                className={classNames.join(' ')}
                style={{ paddingBottom: isBottom ? 16 : 4, paddingLeft: 20, paddingRight: 20 }}
              >
                {showDayHeader && (
                  <div
                    className={`${styles.dayHeaderBar} ${isDaySelected ? styles.dayHeaderSelected : ''}`}
                    onClick={() => onToggleDay?.(dayKey)}
                  >
                    <div className={styles.dayHeaderLeft}>
                      <input
                        type="checkbox"
                        className={styles.dayHeaderCheckbox}
                        checked={isDaySelected}
                        onChange={() => onToggleDay?.(dayKey)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span>{dayHeaderLabel}</span>
                    </div>
                    {statsForDay && (
                      <span className={styles.dayHeaderMeta}>
                        {statsForDay.totalMsgs} msgs · {statsForDay.myMsgs} you
                      </span>
                    )}
                  </div>
                )}
                {showTimestamp && <div className={styles.timestampLabel}>{timestampStr}</div>}
                {isEmail ? (
                  <EmailItem
                    key={msgId}
                    msg={msg}
                    isMyMsg={isMyMsg}
                    showAvatar={showAvatar}
                    showName={showName}
                    isTarget={isTarget}
                    highlightToken={highlightKey}
                  />
                ) : isEvent ? (
                  <EventItem
                    key={msgId}
                    msg={msg}
                    isMyMsg={isMyMsg}
                    isTarget={isTarget}
                    highlightToken={highlightKey}
                  />
                ) : (
                  <MessageItem
                    key={msgId}
                    msg={msg}
                    isMyMsg={isMyMsg}
                    isTarget={isTarget}
                    highlightToken={highlightKey}
                    showAvatar={showAvatar}
                    showName={showName}
                    activePlatform={activeThread?.platform ?? ''}
                    onQuoteClick={() => handleQuoteClick(msg.quoted_message_metadata)}
                  />
                )}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
