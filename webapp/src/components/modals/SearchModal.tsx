import React, { useCallback, useEffect, useRef, useState } from 'react';

import { FaChevronDown, FaChevronUp, FaSearch, FaSpinner, FaTimes, FaUndo } from 'react-icons/fa';
import { Virtuoso } from 'react-virtuoso';

import TextInput from '@/components/TextInput';

import { useForm } from '@/hooks/useForm';

import { PlatformMap } from '@/lib/shared/platforms';

import BaseModal, { ModalHeader } from './BaseModal';
import styles from './SearchModal.module.css';
import SearchResultItem from './SearchResultItem';
import PlatformSelectionDropdown from '../PlatformSelectionDropdown';

interface SearchModalProps {
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

const CategoryLabels: Record<string, string> = {
  message: 'Messages',
  post: 'Posts',
  event: 'Events',
  checkin: 'Check-ins',
  inbox: 'Inbox',
  sent: 'Sent',
};

const initialConfig = {
  query: '',
  filterPlatforms: [] as string[],
  filterCategories: [] as string[],
};

export default function SearchModal({ isOpen, onClose, onNavigate }: SearchModalProps) {
  // 1. State hooks
  const { values: config, setField, resetForm } = useForm(initialConfig);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false); // Initial load
  const [appending, setAppending] = useState(false); // Load more
  const [isSendersExpanded, setIsSendersExpanded] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [facets, setFacets] = useState<{
    platforms: Record<string, number>;
    categories: Record<string, number>;
    senders: Record<string, number>;
  } | null>(null);

  // 2. Ref hooks
  const abortControllerRef = useRef<AbortController | null>(null);
  const isOpenRef = useRef<boolean>(isOpen);

  // 3. Memoized Search fetcher
  const fetchResults = useCallback(
    async (pageNum: number, searchQuery: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const params = new URLSearchParams({
        q: searchQuery,
        page: pageNum.toString(),
      });
      config.filterPlatforms.forEach((p) => {
        params.append('platform', p);
      });
      config.filterCategories.forEach((c) => {
        params.append('type', c);
      });
      try {
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error('Search failed');
        }
        const json = await res.json();
        return json as {
          data: SearchResult[];
          total: number;
          facets?: {
            platforms: Record<string, number>;
            categories: Record<string, number>;
            senders: Record<string, number>;
          };
        };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return null;
        }
        throw e;
      }
    },
    [config.filterPlatforms, config.filterCategories],
  ); // Dependencies for fetchResults

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
  }, [config.query, config.filterPlatforms, config.filterCategories, fetchResults]);

  // Sync isOpen prop to ref
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Reset handler
  const handleReset = () => {
    resetForm();
    setResults([]);
  };

  const handlePlatformChange = (platforms: Set<string>, categories: Set<string>) => {
    setField('filterPlatforms', Array.from(platforms));
    setField('filterCategories', Array.from(categories));
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

  function Footer() {
    return appending ? (
      <div className={styles.footerLoading}>
        <FaSpinner className="spinner" size={24} />
        <span>Loading more...</span>
      </div>
    ) : (
      <div style={{ height: 20 }} /> // Spacer
    );
  }

  return (
    <BaseModal isOpen={isOpen} maxWidth={800} height="80vh" className={styles.modalContent} onClose={onClose}>
      <ModalHeader onClose={onClose} />
      <div className={styles.searchHeader}>
        <div className={styles.searchTopRow}>
          <TextInput
            placeholder="Search messages..."
            value={config.query}
            adornment={<FaSearch className={styles.searchIcon} />}
            className={styles.searchTextInput}
            suffix={
              <div className={styles.inputSuffix}>
                <PlatformSelectionDropdown
                  open={dropdownOpen}
                  selectedPlatforms={new Set(config.filterPlatforms)}
                  selectedCategories={new Set(config.filterCategories)}
                  counts={facets || undefined}
                  width={240}
                  trigger={
                    <button className={styles.suffixDropdown}>
                      <span>
                        Platforms{' '}
                        {config.filterPlatforms.length > 0 || config.filterCategories.length > 0
                          ? `(${config.filterPlatforms.length + config.filterCategories.length})`
                          : ''}
                      </span>
                      <FaChevronDown size={10} />
                    </button>
                  }
                  onOpenChange={setDropdownOpen}
                  onChange={handlePlatformChange}
                />

                <button className={styles.suffixReset} title="Clear search and filters" onClick={handleReset}>
                  <FaUndo size={14} />
                </button>
              </div>
            }
            autoFocus
            onChange={(e) => setField('query', e.target.value)}
          />
        </div>
        <div className={styles.searchMetaRow}>
          <div className={styles.searchHelp}>
            Supports: <b>Two words</b>, <b>&ldquo;Exact phrase&rdquo;</b>, <b>^start</b> matches start of word. <b>*</b>
            =any, <b>?</b>=1 char. <b>OR</b> for boolean search.
          </div>
          {!loading && config.query && totalCount > 0 && (
            <span className={styles.resultsCount}>
              {results.length < totalCount
                ? `${results.length.toLocaleString()} of ${totalCount.toLocaleString()} results`
                : `${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}`}
            </span>
          )}
        </div>

        {(config.filterPlatforms.length > 0 || config.filterCategories.length > 0) && (
          <div className={styles.chipsRow}>
            {config.filterPlatforms.map((p) => (
              <div key={p} className={styles.chip}>
                <span className={styles.chipLabel}>Platform</span>
                {PlatformMap[p] || p}
                <button
                  className={styles.chipRemove}
                  onClick={() => {
                    const next = new Set(config.filterPlatforms);
                    next.delete(p);
                    setField('filterPlatforms', Array.from(next));
                  }}
                >
                  <FaTimes size={10} />
                </button>
              </div>
            ))}
            {config.filterCategories.map((c) => (
              <div key={c} className={styles.chip}>
                <span className={styles.chipLabel}>Category</span>
                {CategoryLabels[c] || c}
                <button
                  className={styles.chipRemove}
                  onClick={() => {
                    const next = new Set(config.filterCategories);
                    next.delete(c);
                    setField('filterCategories', Array.from(next));
                  }}
                >
                  <FaTimes size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {facets && Object.keys(facets.senders).length > 0 && (
          <div className={styles.statsSection}>
            <div className={styles.statsHeader} onClick={() => setIsSendersExpanded(!isSendersExpanded)}>
              {isSendersExpanded ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
              Top Senders
            </div>
            <div className={`${styles.statsContent} ${isSendersExpanded ? styles.statsContentExpanded : ''}`}>
              {Object.entries(facets.senders).map(([sender, count]) => (
                <span key={sender} className={styles.statItem}>
                  {sender} ({count.toLocaleString()})
                </span>
              ))}
            </div>
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
        {!loading && results.length === 0 && config.query && (
          <div className={styles.emptyContainer}>
            <div className={styles.noResultsTitle}>No matches found for &ldquo;{config.query}&rdquo;</div>
            {(config.filterPlatforms.length > 0 || config.filterCategories.length > 0) && (
              <button
                className={styles.noResultsAction}
                onClick={() => {
                  setField('filterPlatforms', []);
                  setField('filterCategories', []);
                }}
              >
                Clear all filters and search again
              </button>
            )}
          </div>
        )}
        {!loading && !!results.length && (
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
    </BaseModal>
  );
}
