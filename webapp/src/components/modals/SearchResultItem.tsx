import React from 'react';

import PlatformIcon from '@/components/PlatformIcon';

import { parseSearchQuery } from '@/lib/shared/search';

import styles from './SearchModal.module.css';

interface SearchResultItemProps {
  result: {
    message_id: number;
    platform: string;
    sender_name: string;
    timestamp: number;
    snippet: string;
    thread_title: string;
  };
  searchQuery: string;
  onClick: () => void;
}

// Helper to highlight matches
function highlightText(text: string, query: string) {
  if (!query.trim()) {
    return text;
  }

  const parsedQuery = parseSearchQuery(query);
  const { orGroups } = parsedQuery;

  // Flatten all tokens from all OR groups for highlighting
  const allTokens = orGroups.flat();

  if (allTokens.length === 0) {
    return text;
  }

  // Build regex pattern using the CLEAN terms (without wildcards)
  // This highlights just the literal search terms, not the wildcard matches
  const cleanTerms = allTokens.map((t) => {
    // Remove wildcards and escape regex special chars
    const term = t.clean.replace(/[*?]/g, '').replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return term;
  });

  const combinedPattern = `(${cleanTerms.filter((t) => t.length > 0).join('|')})`;
  const regex = new RegExp(combinedPattern, 'gi');

  // Find all matches
  const matches: { start: number; end: number; text: string }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }

  if (matches.length === 0) {
    return text;
  }

  // Build result with highlighted matches
  const result: (string | React.ReactElement)[] = [];
  let lastIndex = 0;

  matches.forEach((m, i) => {
    // Add text before match
    if (m.start > lastIndex) {
      result.push(text.substring(lastIndex, m.start));
    }
    // Add highlighted match
    result.push(
      <span key={i} className={styles.highlight}>
        {m.text}
      </span>,
    );
    lastIndex = m.end;
  });

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result;
}

export default function SearchResultItem({ result, searchQuery, onClick }: SearchResultItemProps) {
  const dateStr = new Date(result.timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className={styles.resultItem} onClick={onClick}>
      <div className={styles.iconCol}>
        <PlatformIcon platform={result.platform} />
      </div>
      <div className={styles.contentCol}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.sender}>{result.sender_name}</span>
            <span className={styles.separator}>|</span>
            <span className={styles.threadTitle}>
              {highlightText(result.thread_title || 'Unknown Thread', searchQuery)}
            </span>
          </div>
          <div className={styles.timestamp}>{dateStr}</div>
        </div>
        <div className={styles.snippet}>{highlightText(result.snippet, searchQuery)}</div>
      </div>
    </div>
  );
}
