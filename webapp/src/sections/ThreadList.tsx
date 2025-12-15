import React from 'react';
import { FaSpinner } from 'react-icons/fa';
import styles from './ThreadList.module.css';
import { Thread } from '../types';

interface ThreadListProps {
  activePlatform: string;
  threads: Thread[];
  activeThread: Thread | null;
  loading: boolean;
  onThreadSelect: (thread: Thread) => void;
}

export default function ThreadList({ activePlatform, threads, activeThread, loading, onThreadSelect }: ThreadListProps) {
  return (
    <div className={styles.threadList}>
      <div className={styles.threadListHeader}>{activePlatform} Messages</div>
      <div className={styles.threadScrollContainer}>
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={`${styles.threadItem} ${activeThread?.id === thread.id ? styles.threadItemActive : ''}`}
            onClick={() => onThreadSelect(thread)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onThreadSelect(thread);
              }
            }}
          >
            <div className={styles.threadName}>{thread.title}</div>
            <div className={styles.threadTime}>{new Date(thread.timestamp).toLocaleDateString()}</div>
            <div className={styles.threadSnippet}>{thread.snippet || '(Media)'}</div>
          </div>
        ))}
        {loading ? (
          <div className={styles.loadingContainer}>
            <FaSpinner className={styles.spinner} size={24} />
            <span className={styles.loadingText}>Loading threads...</span>
          </div>
        ) : (
          threads.length === 0 && <div className={styles.noThreads}>No threads found</div>
        )}
      </div>
    </div>
  );
}
