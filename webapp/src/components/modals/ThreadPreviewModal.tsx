import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Message, Thread } from '@/lib/shared/types';
import ChatWindow from '@/sections/ChatWindow';
import BaseModal from './BaseModal';
import styles from './ThreadPreviewModal.module.css';

interface ThreadPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  thread: Thread | null;
}

export default function ThreadPreviewModal({ isOpen, onClose, thread }: ThreadPreviewModalProps) {
  // State matching Home page usage of ChatWindow
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [visiblePage, setVisiblePage] = useState(1);
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);

  // Persist thread data during closing animation
  const lastThreadRef = useRef<Thread | null>(thread);
  if (thread) {
    lastThreadRef.current = thread;
  }
  const displayThread = thread || lastThreadRef.current;

  const totalPages = displayThread?.messageCount ? Math.ceil(displayThread.messageCount / 100) : 1;

  // Mock activeThread object for ChatWindow props (or just use displayThread directly if it matches)
  // We construct a fuller object if needed, or pass displayThread if it satisfies requirements.
  // Ideally ChatWindow accepts a Thread object.
  const activeThread: Thread | null = displayThread
    ? ({
        ...displayThread,
        // Ensure defaults if missing from dataset thread type vs app thread type
        platform: displayThread.platform || 'generic',
        pageCount: totalPages,
        title: displayThread.title || 'Thread Preview',
      } as Thread)
    : null;

  // Track latest request to avoid race conditions
  const latestRequestRef = useRef<symbol | null>(null);

  const loadMessages = useCallback(
    async (tid: string, pageNum: number, mode: 'reset' | 'older' | 'newer') => {
      const requestId = Symbol('loadMessages');
      latestRequestRef.current = requestId;

      if (mode === 'reset') {
        setMessages(null);
      } else {
        setLoading(true);
      }

      try {
        const res = await fetch(
          `/api/messages?threadId=${encodeURIComponent(tid)}&page=${pageNum}&platform=${encodeURIComponent(
            displayThread?.platform || '',
          )}`,
        );

        if (latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.messages || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          if (mode === 'reset') {
            setMessages(newMsgs);
            // Assume page 1. Since it's a preview, we start at 1.
            setHasMoreOld(hasData && isFullPage);
            setHasMoreNew(false);
            setPageRange({ min: pageNum, max: pageNum });
          } else if (mode === 'older') {
            setMessages((prev) => [...(prev || []), ...newMsgs]);
            setHasMoreOld(hasData && isFullPage);
            setPageRange((prev) => ({ ...prev, max: pageNum }));
          } else if (mode === 'newer') {
            setMessages((prev) => [...newMsgs, ...(prev || [])]);
            setHasMoreNew(pageNum > 1);
            setPageRange((prev) => ({ ...prev, min: pageNum }));
          }
        } else {
          if (mode === 'reset') {
            setMessages([]);
          }
          if (mode === 'older') {
            setHasMoreOld(false);
          }
          if (mode === 'newer') {
            setHasMoreNew(false);
          }
        }
      } catch (e) {
        console.error(e);
        if (mode === 'reset') {
          setMessages([]);
        }
      } finally {
        if (latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [displayThread?.platform],
  );

  // Initialize on open
  useEffect(() => {
    if (isOpen && displayThread?.id) {
      setVisiblePage(1);
      loadMessages(displayThread.id, 1, 'reset');
    } else {
      setMessages(null);
    }
  }, [isOpen, displayThread?.id, loadMessages]);

  const handleLoadOld = () => {
    if (!displayThread?.id) {
      return;
    }
    const next = pageRange.max + 1;
    loadMessages(displayThread.id, next, 'older');
  };

  const handleLoadNew = () => {
    if (!displayThread?.id) {
      return;
    }
    const next = pageRange.min - 1;
    if (next < 1) {
      return;
    }
    loadMessages(displayThread.id, next, 'newer');
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={displayThread?.title || 'Thread Preview'}
      subtitle={
        <>
          {displayThread?.platform && <span>{displayThread.platform} </span>}
          <span style={{ opacity: 0.7 }}>
            • Page {visiblePage?.toLocaleString()} of {totalPages.toLocaleString()}
          </span>
        </>
      }
      maxWidth={900}
      height="85vh"
    >
      <div className={styles.messageList}>
        <ChatWindow
          hideHeader
          activeThread={activeThread}
          messages={messages}
          loading={loading}
          hasMoreOld={hasMoreOld}
          hasMoreNew={hasMoreNew}
          pageRange={pageRange}
          onStartReached={handleLoadOld}
          onEndReached={handleLoadNew}
          activePlatform={displayThread?.platform || ''}
          targetMessageId={null}
          highlightToken={0}
          initializing={loading && messages === null}
          onPageChange={setVisiblePage}
        />
      </div>
    </BaseModal>
  );
}
