import React, { useEffect, useRef } from 'react';
import { FaSpinner } from 'react-icons/fa';
import styles from '../styles/index.module.css';
import MessageItem from '../components/MessageItem';
import { Message, Thread, QuotedMessageMetadata } from '../types';

interface ChatWindowProps {
  activeThread: Thread | null;
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  page: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onLoadMore: () => void;
  activePlatform: string;
}

export default function ChatWindow({ activeThread, messages, loading, hasMore, page, searchQuery, onSearchChange, onLoadMore, activePlatform }: ChatWindowProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Autoload effect
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          onLoadMore();
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
  }, [hasMore, loading, onLoadMore]);

  const filteredMessages = messages.filter((msg) => {
    if (!msg.content) {
      return !searchQuery; // Hide media-only if searching text
    }
    if (/reacted\s+.+?\s+to your message/i.test(msg.content)) {
      return false;
    }
    if (searchQuery) {
      return msg.content.toLowerCase().includes(searchQuery.toLowerCase()) || msg.sender_name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  // Scroll to message logic
  const handleQuoteClick = (quoteMetadata: QuotedMessageMetadata | undefined) => {
    if (!quoteMetadata) {
      return;
    }

    // Heuristic: Match content AND sender
    const match = filteredMessages.find((m) => {
      const quoteName = quoteMetadata.creator?.name;
      // Check sender match (handling "You" logic roughly by name match)
      const senderMatch = m.sender_name === quoteName;
      return senderMatch && m.content === quoteMetadata.text;
    });

    if (match) {
      const elId = `msg-${match.id || match.timestamp_ms}`;
      const el = document.getElementById(elId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        console.error('Element not found in DOM');
      }
    } else {
      console.error('Message not found in loaded history');
    }
  };

  if (!activeThread) {
    return (
      <div className={styles.chatArea}>
        <div className={styles.emptyState}>Select a conversation to view</div>
      </div>
    );
  }

  return (
    <div className={styles.chatArea}>
      <div className={styles.chatHeader}>
        <div>
          {activeThread.title}
          <span className={styles.pageIndicator}>
            (Page {page.toLocaleString()} of {(activeThread.file_count || 1).toLocaleString()})
          </span>
        </div>
        <input type="text" className={styles.searchInput} placeholder="Search active chat..." value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <div className={`${styles.messagesContainer} ${messages.length === 0 && loading ? styles.flexCenter : ''}`}>
        {filteredMessages.map((msg, i) => {
          // Determine if my message
          const isMyMsg = !!msg.is_sender;
          const prevMsg = filteredMessages[i + 1];
          const nextMsg = filteredMessages[i - 1];
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
          if (i === filteredMessages.length - 1) {
            showTimestamp = true;
          } else if (filteredMessages[i + 1]) {
            const currentDate = new Date(msg.timestamp_ms);
            const prevDate = new Date(filteredMessages[i + 1].timestamp_ms);
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
            <div id={`msg-${msg.id || msg.timestamp_ms}`} key={i}>
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
        {(hasMore || loading) && (
          <div ref={loadMoreRef} className={styles.loadMoreContainer}>
            {loading && (
              <>
                <FaSpinner className={styles.spinner} size={24} />
                <span className={styles.loadingText}>Loading messages...</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
