import React, { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react';
import { FaSpinner } from 'react-icons/fa';
import { Virtuoso, VirtuosoHandle, IndexLocationWithAlign } from 'react-virtuoso';
import styles from './ChatWindow.module.css';
import MessageItem from '../components/MessageItem';
import { Message, Thread, QuotedMessageMetadata } from '../types';

interface ChatWindowProps {
  activeThread: Thread | null;
  messages: Message[] | null;
  loading: boolean;
  hasMoreOld: boolean;
  hasMoreNew: boolean;
  pageRange: { min: number; max: number };
  onStartReached: () => void;
  onEndReached: () => void;
  activePlatform: string;
  targetMessageId: string | null;
  highlightToken: number;
  initializing?: boolean;
}

const START_INDEX = 10000;

export default function ChatWindow({
  activeThread,
  messages,
  loading,
  hasMoreOld,
  hasMoreNew,
  pageRange,
  onStartReached,
  onEndReached,
  activePlatform,
  targetMessageId,
  highlightToken,
  initializing,
}: ChatWindowProps) {
  // Refs
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const previousMessagesLength = useRef(0);
  const newestMessageIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(false);

  // State
  const [currentTopPage, setCurrentTopPage] = useState(pageRange.min);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [isReady, setIsReady] = useState(false);

  // Memos (data)
  const virtuosoData = useMemo(() => {
    return messages ? [...messages].reverse() : [];
  }, [messages]);

  const targetIndex = useMemo(() => {
    if (!targetMessageId || !virtuosoData.length) {
      return -1;
    }
    return virtuosoData.findIndex((m) => (m.id || m.timestamp_ms.toString()) === targetMessageId);
  }, [targetMessageId, virtuosoData]);

  const initialTopIndex = useMemo<IndexLocationWithAlign>(() => {
    if (targetIndex !== -1) {
      return { index: targetIndex, align: 'center' as const };
    }
    if (pageRange.min === 1) {
      return { index: 'LAST', align: 'end' as const };
    }
    return { index: firstItemIndex, align: 'start' as const };
  }, [targetIndex, pageRange.min, firstItemIndex]);

  // Layout effects
  useLayoutEffect(() => {
    if (!virtuosoData.length) {
      return;
    }

    const currentLen = virtuosoData.length;
    const prevLen = previousMessagesLength.current;

    if (currentLen > prevLen && prevLen > 0) {
      const currentNewest = virtuosoData[currentLen - 1];
      const currentNewestId = currentNewest.id || currentNewest.timestamp_ms.toString();

      // If the newest message hasn't changed, we must have added to the top (History)
      if (currentNewestId === newestMessageIdRef.current) {
        const delta = currentLen - prevLen;
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
  }, [virtuosoData]);

  // Effects

  // Reset on Thread Change
  useEffect(() => {
    setFirstItemIndex(START_INDEX);
    previousMessagesLength.current = 0;
    newestMessageIdRef.current = null;
  }, [activeThread?.id]);

  // Reset atBottom state prevents stale true causing runaway on navigation
  useEffect(() => {
    atBottomRef.current = false;
  }, [messages, targetMessageId]);

  // Ready state logic
  useEffect(() => {
    setIsReady(false);
    const t = setTimeout(() => {
      setIsReady(true);
    }, 500);
    return () => clearTimeout(t);
  }, [activeThread?.id, targetMessageId]);

  // Manual trigger for onEndReached once ready
  useEffect(() => {
    if (isReady && atBottomRef.current && hasMoreNew && !loading) {
      console.log('Manual trigger of onEndReached after ready state');
      onEndReached();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // Imperative scroll when highlightToken changes (e.g. user clicks search result for already loaded thread)
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

    // Normalize Virtuoso index (remove logic offset)
    const normalizedIndex = range.startIndex - firstItemIndex;

    // Safety check
    if (normalizedIndex < 0 || normalizedIndex >= messages.length) {
      return;
    }

    const originalIndex = messages.length - 1 - normalizedIndex;

    // Map original index to page number
    const calculatedPage = pageRange.min + Math.floor(originalIndex / 100);

    setCurrentTopPage(calculatedPage);
  };

  // Components
  const Header = () => {
    return hasMoreOld || loading ? (
      <div className={styles.loadMoreContainer} style={{ padding: 20 }}>
        {loading && hasMoreOld && (
          <>
            <FaSpinner className={styles.spinner} size={24} />
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
            <FaSpinner className={styles.spinner} size={24} />
            <span className={styles.loadingText}>Loading newer...</span>
          </>
        )}
      </div>
    ) : null;
  };

  // Render logic (conditionals)
  if (!activeThread && !initializing) {
    return (
      <div className={styles.chatArea}>
        <div className={styles.emptyState}>Select a conversation</div>
      </div>
    );
  }

  if (initializing || messages === null) {
    return (
      <div className={styles.chatArea}>
        <div className={styles.chatHeader} />
        <div className={styles.messagesContainer}>
          <div className={styles.emptyState}>
            <FaSpinner className={`spin ${styles.spinner}`} size={24} />
            <div className={styles.loadingText}>Loading messages...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chatArea}>
      <div className={styles.chatHeader}>
        <div className={styles.headerTitle}>{activeThread?.title}</div>
        <div className={styles.pageIndicator}>
          (Page {currentTopPage?.toLocaleString()} of {(activeThread?.file_count || 1).toLocaleString()})
        </div>
      </div>

      <div className={styles.messagesContainer}>
        <Virtuoso
          ref={virtuosoRef}
          data={virtuosoData}
          computeItemKey={(index, item) => (item.id ? item.id.toString() : `${item.timestamp_ms}-${index}`)}
          style={{ height: '100%' }}
          firstItemIndex={firstItemIndex}
          followOutput={false} // Explicitly disable sticky bottom behavior
          overscan={200} // Increase overscan for smoother scrolling
          defaultItemHeight={50} // Help Virtuoso estimate layout
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
          atBottomStateChange={(atBottom) => {
            atBottomRef.current = atBottom;
          }}
          itemContent={(index, msg) => {
            // Determine if my message
            const dataIndex = index - firstItemIndex; // Normalize absolute index to 0-based data index

            const isMyMsg = !!msg.is_sender;
            const prevMsg = virtuosoData[dataIndex - 1]; // Above
            const nextMsg = virtuosoData[dataIndex + 1]; // Below

            // isTop: First in a block of same sender (Visually Top)
            const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name;
            // isBottom: Last in a block of same sender (Visually Bottom)
            const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name;

            // Pass flags to MessageItem instead of style objects
            const showAvatar = !isMyMsg && isBottom;
            const showName = !isMyMsg && isTop;

            const isTarget = (msg.id || msg.timestamp_ms.toString()) === targetMessageId;

            let showTimestamp = false;

            // Timestamp Logic: Show if day changed or > 1 hour gap from previous message
            if (prevMsg) {
              const currentDate = new Date(msg.timestamp_ms);
              const prevDate = new Date(prevMsg.timestamp_ms);
              if (
                currentDate.getDate() !== prevDate.getDate() ||
                currentDate.getMonth() !== prevDate.getMonth() ||
                currentDate.getFullYear() !== prevDate.getFullYear() ||
                currentDate.getHours() !== prevDate.getHours()
              ) {
                showTimestamp = true;
              }
            } else {
              // First message of the entire loaded history (top)
              showTimestamp = true;
            }

            const timestampStr = new Date(msg.timestamp_ms).toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });

            return (
              <div style={{ paddingBottom: 4, paddingLeft: 20, paddingRight: 20 }}>
                <MessageItem
                  key={msg.id + (isTarget ? `-highlight-${highlightToken}` : '')}
                  msg={msg}
                  isMyMsg={isMyMsg}
                  isFirst={isTop}
                  isLast={isBottom}
                  isTarget={isTarget}
                  showAvatar={showAvatar}
                  showName={showName}
                  activePlatform={activePlatform}
                  showTimestamp={showTimestamp}
                  timestampStr={timestampStr}
                  onQuoteClick={() => handleQuoteClick(msg.quoted_message_metadata)}
                />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
