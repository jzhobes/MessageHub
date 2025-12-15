import React, { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { FaSpinner } from 'react-icons/fa';
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
  onLoadOld: () => void;
  onLoadNew: () => void;
  activePlatform: string;
  targetMessageId: string | null;
  initializing?: boolean;
}

export default function ChatWindow({ activeThread, messages, loading, hasMoreOld, hasMoreNew, pageRange, onLoadOld, onLoadNew, activePlatform, targetMessageId, initializing }: ChatWindowProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadNewerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPausedNew, setIsPausedNew] = useState(false);
  const scrolledToTop = useRef(false);
  const pivotId = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(pageRange.min);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Callbacks ---

  const updateCurrentPage = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;

      const el = document.elementFromPoint(midX, midY);
      const msgEl = el?.closest('[data-index]');

      if (msgEl) {
        const index = parseInt(msgEl.getAttribute('data-index') || '0', 10);
        // Correct formula: newest page (min) is at index 0.
        const calculatedPage = pageRange.min + Math.floor(index / 100);
        setCurrentPage(calculatedPage);
      }
    }
  }, [pageRange.min]);

  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      return;
    }
    scrollTimeoutRef.current = setTimeout(() => {
      scrollTimeoutRef.current = null;
      updateCurrentPage();
    }, 200);
  }, [updateCurrentPage]);

  const handleQuoteClick = useCallback(
    (quoteMetadata: QuotedMessageMetadata | undefined) => {
      if (!quoteMetadata) {
        return;
      }

      // Heuristic: Match content AND sender
      const match = messages?.find((m) => {
        const quoteName = quoteMetadata.creator?.name;
        // Check sender match (handling "You" logic roughly by name match)
        const senderMatch = m.sender_name === quoteName;
        return senderMatch && m.content === quoteMetadata.text;
      });

      if (match) {
        const elId = `msg-${match.id || match.timestamp_ms}`;
        const el = document.getElementById(elId);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
          el.classList.add(styles.highlightFlash);
          setTimeout(() => el.classList.remove(styles.highlightFlash), 1500);
        } else {
          console.error('Element not found in DOM');
        }
      } else {
        console.error('Message not found in loaded history');
      }
    },
    [messages],
  );

  // --- Layout effects ---

  // Restore scroll lock after render (pivot)
  useLayoutEffect(() => {
    if (pivotId.current) {
      const el = document.getElementById(`msg-${pivotId.current}`);
      if (el) {
        el.scrollIntoView({ block: 'end' });
      }
      pivotId.current = null;
    }
  }, [messages]);

  // --- Side effects ---

  // Prevention mechanism for runaway loading on mount/jump
  useEffect(() => {
    setIsReady(false);
    setIsPausedNew(false);
    scrolledToTop.current = false;
    const timer = setTimeout(() => setIsReady(true), 1000); // 1s grace period
    return () => clearTimeout(timer);
  }, [activeThread?.id]);

  // Unpause newer loading
  useEffect(() => {
    if (isPausedNew) {
      const t = setTimeout(() => setIsPausedNew(false), 1000);
      return () => clearTimeout(t);
    }
  }, [isPausedNew]);

  // Initial scroll logic
  useEffect(() => {
    if (!scrolledToTop.current && !loading && messages?.length && !targetMessageId) {
      if (pageRange.min === 1) {
        // Page 1: start at bottom (newest)
        const newest = messages![0];
        const el = document.getElementById(`msg-${newest.id || newest.timestamp_ms}`);
        if (el) {
          el.scrollIntoView({ block: 'end' });
          scrolledToTop.current = true;
        }
      } else {
        // History page: start at top (oldest) to prevent runaway loop
        const oldest = messages![messages!.length - 1];
        const el = document.getElementById(`msg-${oldest.id || oldest.timestamp_ms}`);
        if (el) {
          el.scrollIntoView({ block: 'start' });
          scrolledToTop.current = true;
        }
      }
    }
  }, [messages, loading, targetMessageId, pageRange.min]);

  // Autoload old (history) effect
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && isReady) {
          console.log('[ChatWindow] Old Intersect. hasMoreOld:', hasMoreOld);
          if (hasMoreOld) {
            onLoadOld();
          }
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMoreOld, loading, onLoadOld, isReady]);

  // Autoload newer (future) effect
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreNew && !loading && isReady && !isPausedNew) {
          // Capture pivot (newest message)
          if (messages?.length) {
            pivotId.current = messages![0].id || messages![0].timestamp_ms.toString();
          }
          setIsPausedNew(true);
          onLoadNew();
        }
      },
      { threshold: 0.1 },
    );

    if (loadNewerRef.current) {
      observer.observe(loadNewerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMoreNew, loading, onLoadNew, isReady, isPausedNew, messages]); // Added messages dependency for pivot access

  // Scroll to target message effect
  useEffect(() => {
    if (targetMessageId && !loading && messages?.length) {
      let attempts = 0;
      const tryScroll = () => {
        const el = document.getElementById(`msg-${targetMessageId}`);
        if (el) {
          console.log(`Scrolling to msg-${targetMessageId}`);
          el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
          el.classList.add(styles.highlightFlash);
          setTimeout(() => el.classList.remove(styles.highlightFlash), 1500);
        } else {
          attempts++;
          if (attempts < 10) {
            setTimeout(tryScroll, 200); // Retry every 200ms up to 2s
          } else {
            console.warn(`Could not find element msg-${targetMessageId} after retries`);
          }
        }
      };

      // Start checking after a short delay to allow rendering
      setTimeout(tryScroll, 100);
    }
  }, [targetMessageId, messages, loading]);

  // Update page on mount/change
  useEffect(() => {
    updateCurrentPage();
  }, [messages, pageRange, updateCurrentPage]);

  if (!activeThread && !initializing) {
    return (
      <div className={styles.chatArea}>
        <div className={styles.emptyState}>Select a conversation</div>
      </div>
    );
  }

  // 1. Initial loading state (central spinner)
  // Display only if we are initializing (URL deep link) or if messages are explicitly null (loading first page)
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

  // 2. Main render logic
  return (
    <div className={styles.chatArea}>
      <div className={styles.chatHeader}>
        <div className={styles.headerTitle}>{activeThread?.title}</div>
        <div className={styles.pageIndicator}>
          (Page {currentPage} of {(activeThread?.file_count || 1).toLocaleString()})
        </div>
      </div>
      <div ref={containerRef} className={styles.messagesContainer} onScroll={handleScroll}>
        {messages?.length === 0 ? (
          <div className={styles.emptyState}>No messages found</div>
        ) : (
          <>
            {loading && hasMoreNew && (
              <div className={styles.loadMoreContainer} style={{ minHeight: '50px' }}>
                <FaSpinner className={styles.spinner} size={24} />
                <span className={styles.loadingText}>Loading newer...</span>
              </div>
            )}
            {!loading && hasMoreNew && <div ref={loadNewerRef} style={{ height: '1px', width: '100%' }} />}
            {messages?.map((msg, i) => {
              // Determine if my message
              const isMyMsg = !!msg.is_sender;
              const prevMsg = messages?.[i + 1];
              const nextMsg = messages?.[i - 1];
              // Use safer checks for top/bottom detection
              const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name;
              const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name;

              // Determine if there is a preview attached
              const urlRegex = /(https?:\/\/[^\s]+)/;
              const contentLinkMatch = msg.content ? msg.content.match(urlRegex) : null;
              const previewUrl = msg.share?.link || (contentLinkMatch ? contentLinkMatch[0] : null);

              // Pass flags to MessageItem instead of style objects
              const showAvatar = !isMyMsg && isBottom;
              const showName = !isMyMsg && isTop;
              const isImageShare = msg.share && msg.share.link && /\.(gif|jpe?g|png|webp)($|\?)/i.test(msg.share.link);
              const hasMedia = (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0) || msg.sticker || isImageShare;
              const isMediaOnly = hasMedia && !msg.content;

              let showTimestamp = false;
              if (messages && i === messages.length - 1) {
                showTimestamp = true;
              } else if (messages?.[i + 1]) {
                const currentDate = new Date(msg.timestamp_ms);
                const prevDate = new Date(messages[i + 1].timestamp_ms);
                if (
                  currentDate.getHours() !== prevDate.getHours() ||
                  currentDate.getDate() !== prevDate.getDate() ||
                  currentDate.getMonth() !== prevDate.getMonth() ||
                  currentDate.getFullYear() !== prevDate.getFullYear()
                ) {
                  showTimestamp = true;
                }
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
                <div id={`msg-${msg.id || msg.timestamp_ms}`} key={msg.id || msg.timestamp_ms} data-index={i}>
                  <MessageItem
                    msg={msg}
                    isMyMsg={isMyMsg}
                    isFirst={isTop}
                    isLast={isBottom}
                    showAvatar={showAvatar}
                    showName={showName}
                    isMediaOnly={!!isMediaOnly}
                    hasPreview={!!previewUrl}
                    activePlatform={activePlatform}
                    showTimestamp={showTimestamp}
                    timestampStr={timestampStr}
                    onQuoteClick={() => handleQuoteClick(msg.quoted_message_metadata)}
                  />
                </div>
              );
            })}
            {(hasMoreOld || loading) && (
              <div ref={loadMoreRef} className={styles.loadMoreContainer}>
                {loading && hasMoreOld && (
                  <>
                    <FaSpinner className={styles.spinner} size={24} />
                    <span className={styles.loadingText}>Loading older...</span>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
