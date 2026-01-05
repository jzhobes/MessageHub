import React, { useCallback, useEffect, useRef, useState } from 'react';

import { getPlatformLabel } from '@/lib/shared/platforms';
import { ContentRecord, Thread } from '@/lib/shared/types';
import ThreadContent from '@/sections/ThreadContent';

import BaseModal, { BaseModalProps, ModalHeader } from './BaseModal';
import styles from './ThreadPreviewModal.module.css';

interface ThreadPreviewModalProps extends Pick<BaseModalProps, 'isOpen' | 'onClose' | 'onAfterClose'> {
  thread: Thread | null;
}

export default function ThreadPreviewModal({ isOpen, thread, onClose, onAfterClose }: ThreadPreviewModalProps) {
  // State matching Home page usage of ChatWindow
  const [messages, setMessages] = useState<ContentRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [visiblePage, setVisiblePage] = useState(1);
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);

  const totalPages = thread?.messageCount ? Math.ceil(thread.messageCount / 100) : 1;

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
          `/api/content?threadId=${encodeURIComponent(tid)}&page=${pageNum}&platform=${encodeURIComponent(
            thread?.platform || '',
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
    [thread?.platform],
  );

  // Initialize on open
  useEffect(() => {
    if (isOpen && thread?.id) {
      setVisiblePage(1);
      loadMessages(thread.id, 1, 'reset');
    }
  }, [isOpen, thread?.id, loadMessages]);

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
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>
          {thread?.title || 'Thread Preview'}
        </h2>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          {thread?.platform && <span>{getPlatformLabel(thread.platform)} </span>}
          <span style={{ opacity: 0.7 }}>
            • Page {visiblePage?.toLocaleString()} of {totalPages.toLocaleString()}
          </span>
        </div>
      </ModalHeader>
      <div className={styles.messageList}>
        <ThreadContent
          activeThread={thread}
          messages={messages}
          loading={loading}
          hasMoreOld={hasMoreOld}
          hasMoreNew={hasMoreNew}
          pageRange={pageRange}
          targetMessageId={null}
          highlightToken={0}
          initializing={loading && messages === null}
          hideHeader
          onStartReached={handleLoadOld}
          onEndReached={handleLoadNew}
          onPageChange={setVisiblePage}
        />
      </div>
    </BaseModal>
  );
}
