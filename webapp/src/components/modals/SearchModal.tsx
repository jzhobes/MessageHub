import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaSearch, FaSpinner, FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { Virtuoso } from 'react-virtuoso';

import TextInput from '@/components/TextInput';
import { Dropdown, DropdownItem, DropdownDivider } from '@/components/Dropdown';
import SearchResultItem from './SearchResultItem';
import BaseModal, { ModalHeader } from './BaseModal';

import { useForm } from '@/hooks/useForm';
import { Thread } from '@/lib/shared/types';
import { PlatformMap } from '@/lib/shared/platforms';

import styles from './SearchModal.module.css';

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

const PLATFORM_ORDER = ['facebook', 'instagram', 'google_chat', 'google_voice', 'google_mail'];

const initialConfig = {
  query: '',
  filterPlatforms: [] as string[],
  filterThreads: [] as string[],
};

export default function SearchModal({ isOpen, onClose, onNavigate }: SearchModalProps) {
  // 1. State hooks
  const { values: config, setField, resetForm } = useForm(initialConfig);
  const [availableThreads, setAvailableThreads] = useState<Thread[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false); // Initial load
  const [appending, setAppending] = useState(false); // Load more
  const [isSendersExpanded, setIsSendersExpanded] = useState(true);
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const [threadDropdownOpen, setThreadDropdownOpen] = useState(false);
  const [facets, setFacets] = useState<{
    platforms: Record<string, number>;
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
      config.filterThreads.forEach((t) => {
        params.append('threadId', t);
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
          facets?: { platforms: Record<string, number>; senders: Record<string, number> };
        };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return null;
        }
        throw e;
      }
    },
    [config.filterPlatforms, config.filterThreads],
  ); // Dependencies for fetchResults

  // Fetch threads when platform filter changes
  useEffect(() => {
    if (config.filterPlatforms.length === 0) {
      setAvailableThreads([]);
      return;
    }
    let ignore = false;
    const fetchThreads = async () => {
      try {
        const params = new URLSearchParams();
        config.filterPlatforms.forEach((p) => params.append('platform', p));
        const res = await fetch(`/api/threads?${params.toString()}`);
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
  }, [config.filterPlatforms]);

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
  }, [config.query, config.filterPlatforms, config.filterThreads, fetchResults]);

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

  const togglePlatform = (p: string) => {
    const next = config.filterPlatforms.includes(p)
      ? config.filterPlatforms.filter((x) => x !== p)
      : [...config.filterPlatforms, p];
    setField('filterPlatforms', next);
    setField('filterThreads', []);
  };

  const toggleThread = (t: string) => {
    const next = config.filterThreads.includes(t)
      ? config.filterThreads.filter((x) => x !== t)
      : [...config.filterThreads, t];
    setField('filterThreads', next);
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

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth={800}
      height="80vh"
      overlayClassName={styles.modalOverlay}
      className={styles.modalContent}
    >
      <ModalHeader onClose={onClose} />
      <div className={styles.searchHeader}>
        <div className={styles.searchTopRow}>
          <TextInput
            autoFocus
            placeholder="Search messages..."
            value={config.query}
            onChange={(e) => setField('query', e.target.value)}
            adornment={<FaSearch className={styles.searchIcon} />}
            className={styles.searchTextInput}
            suffix={
              <div className={styles.inputSuffix}>
                <Dropdown
                  open={platformDropdownOpen}
                  onOpenChange={setPlatformDropdownOpen}
                  width={220}
                  className={styles.dropdownWrapper}
                  trigger={
                    <button className={styles.suffixDropdown}>
                      <span>
                        Platforms {config.filterPlatforms.length > 0 ? `(${config.filterPlatforms.length})` : ''}
                      </span>
                      <FaChevronDown size={10} />
                    </button>
                  }
                >
                  <DropdownItem onClick={() => setField('filterPlatforms', [])}>
                    <input
                      type="checkbox"
                      checked={config.filterPlatforms.length === 0}
                      readOnly
                      className={styles.dropdownCheckbox}
                    />
                    All Platforms {facets && `(${totalCount})`}
                  </DropdownItem>
                  <DropdownDivider />
                  {PLATFORM_ORDER.map((dbKey) => {
                    const label = PlatformMap[dbKey];
                    if (!label) {
                      return null;
                    }

                    const count = facets?.platforms?.[dbKey] || 0;
                    const isSelected = config.filterPlatforms.includes(label);

                    return (
                      <DropdownItem key={dbKey} onClick={() => togglePlatform(label)}>
                        <input type="checkbox" checked={isSelected} readOnly className={styles.dropdownCheckbox} />
                        {label} {count > 0 && <span className={styles.facetCount}>({count})</span>}
                      </DropdownItem>
                    );
                  })}
                </Dropdown>

                <Dropdown
                  open={threadDropdownOpen}
                  onOpenChange={setThreadDropdownOpen}
                  width={280}
                  className={styles.dropdownWrapper}
                  trigger={
                    <button className={styles.suffixDropdown} disabled={availableThreads.length === 0}>
                      <span>Threads {config.filterThreads.length > 0 ? `(${config.filterThreads.length})` : ''}</span>
                      <FaChevronDown size={10} />
                    </button>
                  }
                >
                  <DropdownItem onClick={() => setField('filterThreads', [])}>
                    <input
                      type="checkbox"
                      checked={config.filterThreads.length === 0}
                      readOnly
                      className={styles.dropdownCheckbox}
                    />
                    All Threads
                  </DropdownItem>
                  <DropdownDivider />
                  {availableThreads.map((t) => (
                    <DropdownItem key={t.id} onClick={() => toggleThread(t.id)}>
                      <input
                        type="checkbox"
                        checked={config.filterThreads.includes(t.id)}
                        readOnly
                        className={styles.dropdownCheckbox}
                      />
                      {t.title.length > 30 ? t.title.substring(0, 30) + '...' : t.title}
                    </DropdownItem>
                  ))}
                </Dropdown>

                <button className={styles.suffixReset} onClick={handleReset}>
                  Reset
                </button>
              </div>
            }
          />
        </div>
        <div className={styles.searchMetaRow}>
          <div className={styles.searchHelp}>
            Supports: <b>Two words</b>, <b>&ldquo;Exact phrase&rdquo;</b>. <b>^start</b> matches start of word. <b>*</b>
            =any, <b>?</b>=1 char.
          </div>
          {!loading && config.query && totalCount > 0 && (
            <span className={styles.resultsCount}>
              {results.length < totalCount
                ? `${results.length.toLocaleString()} of ${totalCount.toLocaleString()} results`
                : `${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        {facets && Object.keys(facets.senders).length > 0 && (
          <div className={styles.statsSection}>
            <div className={styles.statsHeader} onClick={() => setIsSendersExpanded(!isSendersExpanded)}>
              {isSendersExpanded ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
              Top Senders
            </div>
            <div className={`${styles.statsContent} ${isSendersExpanded ? styles.statsContentExpanded : ''}`}>
              {Object.entries(facets.senders).map(([sender, count]) => (
                <span key={sender} className={styles.statItem}>
                  {sender} ({count})
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
        {!loading && results.length === 0 && config.query && <div className={styles.empty}>No matches found.</div>}
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
