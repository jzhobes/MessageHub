import React, { useState, useEffect, useRef } from 'react';
import { FaTimes, FaSpinner, FaSearch } from 'react-icons/fa';
import styles from './Search.module.css';
import SearchResultItem from './SearchResultItem';
import { Thread } from '../../types';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (threadId: string, platform: string, messageId: number) => void;
  activeThreadId?: string;
}

export default function GlobalSearch({ isOpen, onClose, onNavigate, activeThreadId }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  /* Filters State */
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterThread, setFilterThread] = useState<string>('all');
  const [availableThreads, setAvailableThreads] = useState<Thread[]>([]);

  // Fetch threads when platform filter changes
  useEffect(() => {
    if (filterPlatform === 'all') {
      setAvailableThreads([]);
      return;
    }

    let ignore = false;
    const fetchThreads = async () => {
      try {
        const res = await fetch(`/api/threads?platform=${encodeURIComponent(filterPlatform)}`);
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            setAvailableThreads(data);
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchThreads();
    return () => {
      ignore = true;
    };
  }, [filterPlatform]);

  // Reset handler
  const handleReset = () => {
    setQuery('');
    setFilterPlatform('all');
    setFilterThread('all');
    setResults([]);
    setAvailableThreads([]);
  };

  /* ... existing SearchResult interface ... */
  interface SearchResult {
    message_id: number;
    thread_id: string;
    platform: string;
    sender_name: string;
    timestamp: number;
    snippet: string;
    thread_title: string;
  }
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Ref to track the current abort controller
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce effect
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const timer = setTimeout(async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const params = new URLSearchParams({
          q: query,
        });

        // Apply Platform Filter
        if (filterPlatform !== 'all') {
          params.append('platform', filterPlatform);
        }

        // Apply Thread Filter
        if (filterThread !== 'all') {
          params.append('threadId', filterThread === 'current' && activeThreadId ? activeThreadId : filterThread);
        }

        const res = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
        });

        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') {
          console.error(e);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      abortControllerRef.current?.abort();
    };
  }, [query, filterPlatform, filterThread, activeThreadId]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <div className={styles.searchTopRow}>
            <div className={styles.searchInputWrapper}>
              <FaSearch className={styles.searchIcon} />
              <input className={styles.searchInput} autoFocus placeholder="Search messages..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className={styles.closeButton} onClick={onClose}>
              <FaTimes />
            </button>
          </div>
          <div className={styles.filtersRow}>
            <select
              className={styles.filterSelect}
              value={filterPlatform}
              onChange={(e) => {
                setFilterPlatform(e.target.value);
                setFilterThread('all'); // Reset thread filter on platform change
              }}
            >
              <option value="all">All Platforms</option>
              <option value="Facebook">Facebook</option>
              <option value="Instagram">Instagram</option>
              <option value="Google Chat">Google Chat</option>
              <option value="Google Voice">Google Voice</option>
            </select>

            <select className={styles.filterSelect} value={filterThread} onChange={(e) => setFilterThread(e.target.value)} disabled={availableThreads.length === 0 && !activeThreadId}>
              <option value="all">All Threads</option>

              {availableThreads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title.length > 20 ? t.title.substring(0, 20) + '...' : t.title}
                </option>
              ))}
            </select>

            <button className={styles.resetButton} onClick={handleReset}>
              Reset
            </button>
          </div>
        </div>
        <div className={styles.resultsList}>
          {loading && (
            <div className={styles.loading}>
              <FaSpinner className={styles.spinner} size={24} />
              <span>Searching...</span>
            </div>
          )}
          {!loading && results.length === 0 && query && <div className={styles.empty}>No matches found.</div>}
          {!loading &&
            results.map((r) => (
              <SearchResultItem
                key={r.message_id}
                result={r}
                searchQuery={query}
                onClick={() => {
                  onNavigate(r.thread_id, r.platform, r.message_id);
                  onClose();
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
