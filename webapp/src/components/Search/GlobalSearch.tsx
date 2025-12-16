import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaTimes, FaSpinner, FaSearch } from 'react-icons/fa';
import { Virtuoso } from 'react-virtuoso';
import styles from './Search.module.css';
import SearchResultItem from './SearchResultItem';
import { Thread } from '../../types';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (threadId: string, platform: string, messageId: number) => void;
}

interface SearchResult {
  message_id: number;
  thread_id: string;
  platform: string;
  sender_name: string;
  timestamp: number;
  snippet: string;
  thread_title: string;
}

export default function GlobalSearch({ isOpen, onClose, onNavigate }: GlobalSearchProps) {
  // State hooks
  const [query, setQuery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterThread, setFilterThread] = useState('all');
  const [availableThreads, setAvailableThreads] = useState<Thread[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false); // Initial load
  const [appending, setAppending] = useState(false); // Load more

  // Ref hooks
  const abortControllerRef = useRef<AbortController | null>(null);
  const isOpenRef = useRef<boolean>(isOpen);

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

  // Debounce effect for Query/Filters
  useEffect(() => {
    if (!isOpenRef.current) {
      console.log('Search is closed');
      return;
    }
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    const timer = setTimeout(async () => {
      setPage(1);
      setHasMore(true);
      setLoading(true);
      try {
        const resp = await fetchResults(1, query);
        if (resp !== null) {
          setResults(resp.data);
          setTotalCount(resp.total);
          setHasMore(resp.data.length < resp.total);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      abortControllerRef.current?.abort();
    };
  }, [query, filterPlatform, filterThread]);

  // Sync isOpen prop to ref
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Search fetcher
  const fetchResults = async (pageNum: number, searchQuery: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const params = new URLSearchParams({
      q: searchQuery,
      page: pageNum.toString(),
    });
    if (filterPlatform !== 'all') {
      params.append('platform', filterPlatform);
    }
    if (filterThread !== 'all') {
      params.append('threadId', filterThread);
    }
    try {
      const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error('Search failed');
      }
      const json = await res.json();
      return json as { data: SearchResult[]; total: number };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return null;
      }
      throw e;
    }
  };

  // Reset handler
  const handleReset = () => {
    setQuery('');
    setFilterPlatform('all');
    setFilterThread('all');
    setResults([]);
    setAvailableThreads([]);
  };

  const handleEndReached = useCallback(() => {
    if (!hasMore || loading || appending) {
      return;
    }

    setAppending(true);
    const nextPage = page + 1;
    setPage(nextPage);

    (async () => {
      try {
        const resp = await fetchResults(nextPage, query);
        if (resp !== null) {
          setResults((prev) => [...prev, ...resp.data]);
          setHasMore(results.length + resp.data.length < resp.total);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setAppending(false);
      }
    })();
  }, [hasMore, loading, appending, page, query, results.length]); // Dependencies for callback

  const Footer = () => {
    return appending ? (
      <div className={styles.footerLoading}>
        <FaSpinner className={styles.spinner} size={24} />
        <span>Loading more...</span>
      </div>
    ) : (
      <div style={{ height: 20 }} /> // Spacer
    );
  };

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

            <select className={styles.filterSelect} value={filterThread} onChange={(e) => setFilterThread(e.target.value)} disabled={availableThreads.length === 0}>
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
            {!loading && query && totalCount > 0 && (
              <span className={styles.resultsCount}>
                {results.length < totalCount ? `${results.length.toLocaleString()} of ${totalCount.toLocaleString()} results` : `${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>
        <div className={styles.resultsList}>
          {loading && !appending && (
            <div className={styles.loading}>
              <FaSpinner className={styles.spinner} size={24} />
              <span>Searching...</span>
            </div>
          )}
          {!loading && results.length === 0 && query && <div className={styles.empty}>No matches found.</div>}
          {results.length && (
            <Virtuoso
              style={{ height: '100%' }}
              data={results}
              endReached={handleEndReached}
              overscan={200}
              components={{ Footer }}
              itemContent={(index, r) => (
                <SearchResultItem
                  key={`${r.message_id}_${r.thread_id}`}
                  result={r}
                  searchQuery={query}
                  onClick={() => {
                    onNavigate(r.thread_id, r.platform, r.message_id);
                    onClose();
                  }}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
