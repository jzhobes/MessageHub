import React from 'react';
import { FaFacebook, FaInstagram, FaPhone } from 'react-icons/fa';
import { SiGooglechat } from 'react-icons/si';
import styles from './Search.module.css';

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
    if (lower.includes('google') || lower.includes('chat')) {
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

    // Tokenize query: split by spaces but respect quotes
    const tokens: string[] = [];
    const quoteRegex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = quoteRegex.exec(query)) !== null) {
      if (match[1]) {
        tokens.push(match[1]);
      } else {
        tokens.push(match[2]);
      }
    }

    if (tokens.length === 0) {
      return text;
    }

    // Build regex pattern for all tokens
    const patterns = tokens.map((t) => {
      let pattern = t;
      let isStart = false;
      if (pattern.startsWith('^')) {
        isStart = true;
        pattern = pattern.slice(1);
      }

      // Escape regex special characters, but preserve * and ?
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*?')
        .replace(/\?/g, '.');

      if (isStart) {
        // Match start of string or word boundary
        return `(?:^|\\b)${escaped}`;
      }
      return escaped;
    });

    const combinedPattern = `(${patterns.join('|')})`;
    const parts = text.split(new RegExp(combinedPattern, 'gi'));

    return parts.map((part, i) => {
      // Check if this part matches one of our tokens (case-insensitive)
      // Since split includes the separator, we just check if it matches the regex
      // But verify it's not empty string or irrelevant
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
