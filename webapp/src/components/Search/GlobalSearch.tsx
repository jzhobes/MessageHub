import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaSearch, FaSpinner, FaTimes } from 'react-icons/fa';
import { Virtuoso } from 'react-virtuoso';
import { useForm } from '@/hooks/useForm';
import { Thread } from '@/lib/shared/types';
import styles from './Search.module.css';
import SearchResultItem from './SearchResultItem';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (messageId: number) => void;
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

const initialConfig = {
  query: '',
  filterPlatform: 'all',
  filterThread: 'all',
};

export default function GlobalSearch({ isOpen, onClose, onNavigate }: GlobalSearchProps) {
  // State hooks
  const { values: config, setField, resetForm } = useForm(initialConfig);
  const [availableThreads, setAvailableThreads] = useState<Thread[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false); // Initial load
  const [appending, setAppending] = useState(false); // Load more

  const [facets, setFacets] = useState<{
    platforms: Record<string, number>;
    senders: Record<string, number>;
  } | null>(null);

  // Ref hooks
  const abortControllerRef = useRef<AbortController | null>(null);
  const isOpenRef = useRef<boolean>(isOpen);

  // Search fetcher
  const fetchResults = useCallback(
    async (pageNum: number, searchQuery: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const params = new URLSearchParams({
        q: searchQuery,
        page: pageNum.toString(),
      });
      if (config.filterPlatform !== 'all') {
        params.append('platform', config.filterPlatform);
      }
      if (config.filterThread !== 'all') {
        params.append('threadId', config.filterThread);
      }
      try {
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error('Search failed');
        }
        const json = await res.json();
        return json as {
          data: SearchResult[];
          total: number;
          facets?: { platforms: Record<string, number>; senders: Record<string, number> };
        };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return null;
        }
        throw e;
      }
    },
    [config.filterPlatform, config.filterThread],
  ); // Dependencies for fetchResults

  // Fetch threads when platform filter changes
  useEffect(() => {
    if (config.filterPlatform === 'all') {
      setAvailableThreads([]);
      return;
    }
    let ignore = false;
    const fetchThreads = async () => {
      try {
        const res = await fetch(`/api/threads?platform=${encodeURIComponent(config.filterPlatform)}`);
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
  }, [config.filterPlatform]);

  // Debounce effect for Query/Filters
  useEffect(() => {
    if (!isOpenRef.current) {
      console.log('Search is closed');
      return;
    }
    if (!config.query.trim()) {
      setResults([]);
      setFacets(null);
      setLoading(false);
      return;
    }
    const timer = setTimeout(async () => {
      setPage(1);
      setHasMore(true);
      setLoading(true);
      try {
        const resp = await fetchResults(1, config.query);
        if (resp !== null) {
          setResults(resp.data);
          setTotalCount(resp.total);
          setFacets(resp.facets || null);
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
  }, [config.query, config.filterPlatform, config.filterThread, fetchResults]);

  // Sync isOpen prop to ref
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Reset handler
  const handleReset = () => {
    resetForm();
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
        const resp = await fetchResults(nextPage, config.query);
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
  }, [hasMore, loading, appending, page, config.query, results.length, fetchResults]); // Dependencies for callback

  const Footer = () => {
    return appending ? (
      <div className={styles.footerLoading}>
        <FaSpinner className="spinner" size={24} />
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
              <input className={styles.searchInput} autoFocus placeholder="Search messages..." value={config.query} onChange={(e) => setField('query', e.target.value)} />
            </div>
            <button className={styles.closeButton} onClick={onClose}>
              <FaTimes />
            </button>
          </div>
          <div className={styles.searchHelp}>
            Supports: <b>Two words</b>, <b>&ldquo;Exact phrase&rdquo;</b>. <b>^start</b> matches start of word. <b>*</b>=any, <b>?</b>=1 char.
          </div>
          <div className={styles.filtersRow}>
            <select
              className={styles.filterSelect}
              value={config.filterPlatform}
              onChange={(e) => {
                setField('filterPlatform', e.target.value);
                setField('filterThread', 'all'); // Reset thread filter on platform change
              }}
            >
              <option value="all">All Platforms {facets && `(${totalCount})`}</option>
              <option value="Facebook">Facebook {facets?.platforms?.['Facebook'] ? `(${facets.platforms['Facebook']})` : ''}</option>
              <option value="Instagram">Instagram {facets?.platforms?.['Instagram'] ? `(${facets.platforms['Instagram']})` : ''}</option>
              <option value="Google Chat">Google Chat {facets?.platforms?.['Google Chat'] ? `(${facets.platforms['Google Chat']})` : ''}</option>
              <option value="Google Voice">Google Voice {facets?.platforms?.['Google Voice'] ? `(${facets.platforms['Google Voice']})` : ''}</option>
            </select>

            <select className={styles.filterSelect} value={config.filterThread} onChange={(e) => setField('filterThread', e.target.value)} disabled={availableThreads.length === 0}>
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
            {!loading && config.query && totalCount > 0 && (
              <span className={styles.resultsCount}>
                {results.length < totalCount ? `${results.length.toLocaleString()} of ${totalCount.toLocaleString()} results` : `${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
          {facets && Object.keys(facets.senders).length > 0 && (
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Top Senders:</span>
              {Object.entries(facets.senders).map(([sender, count]) => (
                <span key={sender} className={styles.statItem}>
                  {sender} ({count})
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={styles.resultsList}>
          {loading && !appending && (
            <div className={styles.loading}>
              <FaSpinner className="spinner" size={24} />
              <span>Searching...</span>
            </div>
          )}
          {!loading && results.length === 0 && config.query && <div className={styles.empty}>No matches found.</div>}
          {!!results.length && (
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
                  searchQuery={config.query}
                  onClick={() => {
                    onNavigate(r.message_id);
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
