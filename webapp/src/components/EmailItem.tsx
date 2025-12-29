import React, { useEffect, useMemo, useRef } from 'react';

import DOMPurify from 'dompurify';

import { ContentRecord } from '@/lib/shared/types';

import styles from './EmailItem.module.css';

interface EmailItemProps {
  msg: ContentRecord;
  isMyMsg: boolean;
  showAvatar: boolean;
  showName: boolean;
  isTarget?: boolean;
  highlightToken?: number;
}

const EmailItem = React.memo(({ msg, isMyMsg, showAvatar, showName, isTarget, highlightToken }: EmailItemProps) => {
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isTarget && bubbleRef.current && highlightToken) {
      const color = isMyMsg ? 'var(--bubble-sent-bg)' : 'var(--bubble-received-bg)';
      const animation = bubbleRef.current.animate(
        [
          { transform: 'scale(1)', boxShadow: '0 0 0 0 var(--highlight-border)' },
          { transform: 'scale(1.02)', boxShadow: `0 0 0 5px ${color}` },
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)' },
        ],
        { duration: 1000, easing: 'ease-in-out' },
      );
      return () => animation.cancel();
    }
  }, [isTarget, highlightToken, isMyMsg]);

  const formatTime = (ms: number) => {
    return new Date(ms).toLocaleString();
  };

  const bubbleClasses = [styles.emailBubble, isMyMsg ? styles.sentBubble : styles.receivedBubble].join(' ');

  // Sanitize content only in browser to avoid SSR mismatch
  const sanitizedContent = useMemo(() => {
    return typeof window !== 'undefined' ? DOMPurify.sanitize(msg.content || '') : msg.content || '';
  }, [msg.content]);

  return (
    <div className={styles.emailRowContainer}>
      <div className={`${styles.emailRow} ${isMyMsg ? styles.justifyRight : styles.justifyLeft}`}>
        {!isMyMsg && (
          <div className={styles.avatarArea}>
            {showAvatar && (
              <div className={styles.profileImage} title={msg.sender_name}>
                {msg.sender_name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        )}

        <div className={`${styles.emailContentStack} ${isMyMsg ? styles.alignRight : styles.alignLeft}`}>
          {showName && <div className={styles.senderNameOutside}>{msg.sender_name}</div>}
          <div ref={bubbleRef} className={bubbleClasses} title={formatTime(msg.timestamp_ms)}>
            <div className={styles.emailBody} dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
          </div>
        </div>
      </div>
    </div>
  );
});

EmailItem.displayName = 'EmailItem';
export default EmailItem;
