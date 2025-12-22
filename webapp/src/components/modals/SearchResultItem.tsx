import React from 'react';
import { FaFacebook, FaInstagram, FaPhone } from 'react-icons/fa';
import { SiGooglechat, SiGmail } from 'react-icons/si';
import styles from './SearchModal.module.css';
import { parseSearchQuery } from '@/lib/shared/search';

interface SearchResultItemProps {
  result: {
    message_id: number;
    platform: string;
    sender_name: string;
    timestamp: number;
    snippet: string;
    thread_title: string;
  };
  onClick: () => void;
  searchQuery: string;
}

export default function SearchResultItem({ result, onClick, searchQuery }: SearchResultItemProps) {
  const getIcon = (p: string) => {
    const lower = p ? p.toLowerCase() : '';
    if (lower === 'facebook') {
      return <FaFacebook size={20} color="#1877F2" />;
    }
    if (lower === 'instagram') {
      return <FaInstagram size={20} color="#E4405F" />;
    }
    if (lower.includes('gmail') || lower.includes('mail')) {
      return <SiGmail size={20} color="#EA4335" />;
    }
    if (lower.includes('google chat')) {
      return <SiGooglechat size={20} color="#00AC47" />;
    }
    return <FaPhone size={20} color="#666" />;
  };

  const dateStr = new Date(result.timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  // Helper to highlight matches
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) {
      return text;
    }

    const tokens = parseSearchQuery(query);
    if (tokens.length === 0) {
      return text;
    }

    // Build regex pattern for all tokens using the shared regexPattern logic
    const combinedPattern = `(${tokens.map((t) => t.regexPattern).join('|')})`;
    const parts = text.split(new RegExp(combinedPattern, 'gi'));

    return parts.map((part, i) => {
      const isMatch = new RegExp(`^${combinedPattern}$`, 'i').test(part);
      return isMatch ? (
        <span key={i} className={styles.highlight}>
          {part}
        </span>
      ) : (
        part
      );
    });
  };

  return (
    <div className={styles.resultItem} onClick={onClick}>
      <div className={styles.iconCol}>{getIcon(result.platform)}</div>
      <div className={styles.contentCol}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.sender}>{result.sender_name}</span>
            <span className={styles.separator}>|</span>
            <span className={styles.threadTitle}>{result.thread_title || 'Unknown Thread'}</span>
          </div>
          <div className={styles.timestamp}>{dateStr}</div>
        </div>
        <div className={styles.snippet}>{highlightText(result.snippet, searchQuery)}</div>
      </div>
    </div>
  );
}
