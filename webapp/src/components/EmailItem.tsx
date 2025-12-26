import React from 'react';
import DOMPurify from 'dompurify';
import { ContentRecord } from '@/lib/shared/types';
import styles from './EmailItem.module.css';

interface EmailItemProps {
  msg: ContentRecord;
  isMyMsg: boolean;
  showAvatar: boolean;
  showName: boolean;
}

export default function EmailItem({ msg, isMyMsg, showAvatar, showName }: EmailItemProps) {
  const formatTime = (ms: number) => {
    return new Date(ms).toLocaleString();
  };

  const bubbleClasses = [styles.emailBubble, isMyMsg ? styles.sentBubble : styles.receivedBubble].join(' ');

  // Sanitize content only in browser to avoid SSR mismatch
  const sanitizedContent = typeof window !== 'undefined' ? DOMPurify.sanitize(msg.content || '') : msg.content || '';

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
          <div className={bubbleClasses} title={formatTime(msg.timestamp_ms)}>
            <div className={styles.emailBody} dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
          </div>
        </div>
      </div>
    </div>
  );
}
