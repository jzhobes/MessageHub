import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import { Message, Thread } from '@/lib/shared/types';
import ChatWindow from '@/sections/ChatWindow';
import styles from './ThreadPreviewModal.module.css';

interface ThreadPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  threadId: string | null;
  threadTitle?: string;
  platform?: string;
}

export default function ThreadPreviewModal({ isOpen, onClose, threadId, threadTitle, platform }: ThreadPreviewModalProps) {
  // State matching Home page usage of ChatWindow
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);

  // Mock activeThread object for ChatWindow props
  const activeThread: Thread | null = threadId
    ? ({
        id: threadId,
        title: threadTitle || 'Thread Preview',
        platform: platform || 'generic',
        file_count: 1000, // unlimited scrolling for preview
        timestamp: Date.now(),
        // Add other required fields with dummy values
        download_path: '',
        message_count: 0,
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
        const res = await fetch(`/api/messages?threadId=${encodeURIComponent(tid)}&page=${pageNum}&platform=${encodeURIComponent(platform || '')}`);

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
            // If API returns < 100, no more old (history).
            // In this app "older" means higher page numbers (back in time).
            setHasMoreOld(hasData && isFullPage);
            setHasMoreNew(false); // We start at most recent, so no newer
            setPageRange({ min: pageNum, max: pageNum });
          } else if (mode === 'older') {
            // Prepend? No, older messages (higher page) usually go to the TOP of the chat (historically older).
            // ChatWindow receives [old, ..., new].
            // If we fetch Page 2 (older), it should be prepended to the array.
            // Wait, let's allow ChatWindow logic to dictate.
            // In index.tsx: Older -> setMessages((prev) => [...(prev || []), ...newMsgs]);
            // Wait, index.tsx actually APPENDS older messages?
            // Let's re-read index.tsx carefully. Ref Step 124.
            /* 
               else if (mode === 'older') {
                 setMessages((prev) => [...(prev || []), ...newMsgs]);
               }
            */
            // This implies the array is [Newest ... Oldest]?
            // Let's check ChatWindow virtuosoData logic.
            /*
               const virtuosoData = useMemo(() => {
                 return messages ? [...messages].reverse() : [];
               }, [messages]);
            */
            // If ChatWindow REVERSES the array, then `messages` must be descending (Newest -> Oldest).
            // So appending to `messages` adds OLDER items (later in time... no, earlier in time).
            // Page 2 is older than Page 1.
            // So yes, appending to `messages` array means adding older items.
            // ChatWindow reverses it to be [Oldest ... Newest] for display.
            // Correct.
            setMessages((prev) => [...(prev || []), ...newMsgs]);
            setHasMoreOld(hasData && isFullPage);
            setPageRange((prev) => ({ ...prev, max: pageNum }));
          } else if (mode === 'newer') {
            // Newer messages (lower page number) should be prepended to `messages` array
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
    [platform],
  );

  // Initialize on open
  useEffect(() => {
    if (isOpen && threadId) {
      loadMessages(threadId, 1, 'reset');
    } else {
      setMessages(null);
    }
  }, [isOpen, threadId, loadMessages]);

  const handleLoadOld = () => {
    if (!threadId) {
      return;
    }
    const next = pageRange.max + 1;
    loadMessages(threadId, next, 'older');
  };

  const handleLoadNew = () => {
    if (!threadId) {
      return;
    }
    const next = pageRange.min - 1;
    if (next < 1) {
      return;
    }
    loadMessages(threadId, next, 'newer');
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ height: '85vh', width: '900px' }}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.title}>{threadTitle || 'Thread Preview'}</div>
            {platform && <div className={styles.subtitle}>{platform}</div>}
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close Preview">
            <FaTimes />
          </button>
        </div>

        <div className={styles.messageList}>
          <ChatWindow
            activeThread={activeThread}
            messages={messages}
            loading={loading}
            hasMoreOld={hasMoreOld}
            hasMoreNew={hasMoreNew}
            pageRange={pageRange}
            onStartReached={handleLoadOld}
            onEndReached={handleLoadNew}
            activePlatform={platform || ''}
            targetMessageId={null}
            highlightToken={0}
            initializing={loading && messages === null}
          />
        </div>
      </div>
    </div>
  );
}
