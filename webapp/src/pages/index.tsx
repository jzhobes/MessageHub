import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaArrowLeft, FaBars, FaCog, FaSearch } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';

import styles from '@/components/Layout.module.css';
import MediaPanel from '@/components/MediaPanel';
import DemoInfoModal from '@/components/modals/DemoInfoModal';
import SearchModal from '@/components/modals/SearchModal';
import SetupModal from '@/components/modals/SetupModal';
import Tooltip from '@/components/Tooltip';

import { useTheme } from '@/hooks/useTheme';

import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/client/apiClient';
import { IS_DEMO_MODE } from '@/lib/client/env';
import { ContentRecord, Thread } from '@/lib/shared/types';
import Sidebar from '@/sections/Sidebar';
import ThreadContent from '@/sections/ThreadContent';
import ThreadList from '@/sections/ThreadList';

const platformPreference = ['facebook', 'instagram', 'google_chat', 'google_mail', 'google_voice'];

function resolvePlatform(candidate: string | undefined, availableMap: Record<string, boolean>) {
  if (candidate && availableMap[candidate]) {
    return candidate;
  }

  for (const p of platformPreference) {
    if (availableMap[p]) {
      return p;
    }
  }
  // Use the requested candidate or the default when no platform has data.
  return candidate || platformPreference[0];
}

function subscribeWindowWidth(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

function getWindowWidth() {
  return window.innerWidth;
}

function getServerWindowWidth() {
  return 0;
}

export default function Home() {
  const router = useRouter();
  const { isInitialized, availability } = useApp();
  const { theme, toggleTheme, mounted } = useTheme();

  // --- Layout / Viewport State ---
  const windowWidth = useSyncExternalStore(subscribeWindowWidth, getWindowWidth, getServerWindowWidth);
  const isMobile = windowWidth > 0 && windowWidth < 768;

  const [showSidebar, setShowSidebar] = useState(true);
  const [showMedia, setShowMedia] = useState(false);
  const [prevWindowWidth, setPrevWindowWidth] = useState(0);

  // Collapse the sidebar on the first client measurement or when the viewport crosses the breakpoint.
  const sidebarThreshold = showMedia ? 1350 : 1024;
  if (windowWidth !== prevWindowWidth) {
    if (prevWindowWidth === 0 && windowWidth > 0) {
      setShowSidebar(windowWidth >= sidebarThreshold);
    } else if (prevWindowWidth > 0) {
      if (prevWindowWidth >= sidebarThreshold && windowWidth < sidebarThreshold) {
        setShowSidebar(false);
      } else if (prevWindowWidth < sidebarThreshold && windowWidth >= sidebarThreshold) {
        setShowSidebar(true);
      }
    }
    setPrevWindowWidth(windowWidth);
  }

  // --- URL-Derived Platform, Category & Thread ---
  const platformParam = typeof router.query.platform === 'string' ? router.query.platform : undefined;
  const typeParam = typeof router.query.type === 'string' ? router.query.type : undefined;
  const threadIdParam = typeof router.query.threadId === 'string' ? router.query.threadId : undefined;
  const pageParam = typeof router.query.page === 'string' ? router.query.page : undefined;

  const activePlatform = resolvePlatform(platformParam, availability);
  const defaultCat = activePlatform === 'google_mail' ? 'inbox' : 'message';
  const activeCategory = typeParam || defaultCat;

  // --- Data & UI State ---
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ContentRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [targetTimestamp, setTargetTimestamp] = useState<number | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [highlightToken, setHighlightToken] = useState(0);

  const hasCheckedBgIngestRef = useRef(false);
  const latestRequestRef = useRef<symbol | null>(null);

  // Pagination State
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);

  // Reset thread/message lists when platform or category changes
  const platformCategoryKey = `${activePlatform}:${activeCategory}`;
  const [prevPlatformCategoryKey, setPrevPlatformCategoryKey] = useState(platformCategoryKey);
  if (platformCategoryKey !== prevPlatformCategoryKey) {
    setPrevPlatformCategoryKey(platformCategoryKey);
    setThreads(null);
    setMessages(null);
    if (activePlatform === 'google_mail' && showMedia) {
      setShowMedia(false);
      if (windowWidth >= 1024) {
        setShowSidebar(true);
      }
    }
  }

  const activeThread = useMemo<Thread | null>(() => {
    if (!threads?.length) {
      return null;
    }
    if (threadIdParam) {
      const target = threads.find((t) => t.id === threadIdParam);
      return target ? { ...target, platform: activePlatform } : null;
    }
    return !isMobile ? { ...threads[0], platform: activePlatform } : null;
  }, [threads, threadIdParam, activePlatform, isMobile]);

  const activeThreadId = activeThread?.id ?? null;
  const activeThreadPageCount = activeThread?.pageCount;

  const parsedPage = pageParam ? parseInt(pageParam, 10) : 1;
  const startPage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const [pageLoadFailed, setPageLoadFailed] = useState(false);
  const [reloadPageToken, setReloadPageToken] = useState(0);
  const targetLoadKey =
    activeThreadId && (!threadIdParam || threadIdParam === activeThreadId)
      ? `${activePlatform}:${activeThreadId}:${startPage}:${reloadPageToken}`
      : '';

  const [prevLoadKey, setPrevLoadKey] = useState('');
  if (targetLoadKey !== prevLoadKey) {
    setPrevLoadKey(targetLoadKey);
    setPageLoadFailed(false);
    if (targetLoadKey) {
      setPageRange({ min: startPage, max: startPage });
      setMessages(null);
      setHasMoreOld(false);
      setHasMoreNew(false);
    }
  }

  // --- Callbacks & Helpers ---

  const updateUrl = useCallback(
    (platform: string, threadId?: string, pageNum?: number, category?: string) => {
      const query: Record<string, string> = { platform };
      const activeCat = category || activeCategory;

      if (activeCat && activeCat !== 'message' && activeCat !== 'inbox') {
        query.type = activeCat;
      }
      if (threadId) {
        query.threadId = threadId;
      }
      if (pageNum && pageNum > 1) {
        query.page = pageNum.toString();
      }

      return router.push(
        {
          pathname: '/',
          query: query,
        },
        undefined,
        { scroll: false },
      );
    },
    [router, activeCategory],
  );

  const handleShowMediaChange = useCallback((next: boolean) => {
    setShowMedia(next);
    const width = window.innerWidth;
    if (next) {
      if (width < 1350) {
        setShowSidebar(false);
      }
    } else if (width >= 1024) {
      setShowSidebar(true);
    }
  }, []);

  // Load Older/Newer Messages Helper
  const loadMessages = useCallback(
    async (threadId: string, pageNum: number, mode: 'older' | 'newer') => {
      if (!activeThreadId || activeThreadId !== threadId) {
        return;
      }

      const requestId = Symbol('loadMessages');
      latestRequestRef.current = requestId;

      setLoading(true);

      try {
        const res = await apiFetch(
          `/api/content?threadId=${encodeURIComponent(threadId)}&page=${pageNum}&platform=${encodeURIComponent(activePlatform)}`,
        );

        // Ignore a response if a newer request took over.
        if (latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.records || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          if (mode === 'older') {
            setMessages((prev) => [...(prev || []), ...newMsgs]);
            if (activeThreadPageCount) {
              setHasMoreOld(pageNum < activeThreadPageCount);
            } else {
              setHasMoreOld(hasData && isFullPage);
            }
            setPageRange((prev) => ({ ...prev, max: pageNum }));
          } else {
            setMessages((prev) => [...newMsgs, ...(prev || [])]);
            setHasMoreNew(pageNum > 1);
            setPageRange((prev) => ({ ...prev, min: pageNum }));
          }
        } else {
          if (mode === 'older') {
            setHasMoreOld(false);
          } else {
            setHasMoreNew(false);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        // Leave the spinner to the current request if this one was superseded.
        if (latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [activePlatform, activeThreadId, activeThreadPageCount],
  );

  const handleThreadNavigate = async (page: number, timestamp?: number) => {
    if (!activeThreadId) {
      return;
    }

    setTargetMessageId(null);
    setTargetTimestamp(timestamp ?? null);
    if (timestamp != null) {
      setHighlightToken((value) => value + 1);
    }

    if (page === startPage && threadIdParam === activeThreadId) {
      // Scrolling can move away from the URL's page without changing the URL.
      setReloadPageToken((value) => value + 1);
      return;
    }
    const navigated = await updateUrl(activePlatform, activeThreadId, page, activeCategory);
    if (!navigated) {
      throw new Error('Unable to open this page.');
    }
  };

  const handlePlatformSelect = useCallback(
    (p: string) => {
      const safePlatform = resolvePlatform(p, availability);
      const defaultCategory = safePlatform === 'google_mail' ? 'inbox' : 'message';

      // 1. Same platform/category selection
      if (safePlatform === activePlatform && activeCategory === defaultCategory) {
        if (isMobile) {
          if (activeThreadId) {
            setMessages(null);
            updateUrl(safePlatform, undefined, undefined, defaultCategory);
          }
          setShowSidebar(false);
        }
        return;
      }

      // 2. Changing Platform or Category:
      // Reset the selection. Changing the platform or category will fetch the new threads.
      setThreads(null);
      setMessages(null);
      updateUrl(safePlatform, undefined, undefined, defaultCategory);

      if (isMobile) {
        setShowSidebar(false);
      }
    },
    [availability, updateUrl, isMobile, activePlatform, activeCategory, activeThreadId],
  );

  const handleCategoryChange = useCallback(
    (cat: string) => {
      // 1. Same category selection
      if (cat === activeCategory) {
        if (isMobile && activeThreadId) {
          setMessages(null);
          updateUrl(activePlatform, undefined, undefined, cat);
        }
        return;
      }

      // 2. Changing category
      setThreads(null);
      setMessages(null);
      updateUrl(activePlatform, undefined, undefined, cat);
    },
    [activePlatform, updateUrl, activeCategory, activeThreadId, isMobile],
  );

  const handleThreadSelect = useCallback(
    (t: Thread) => {
      if (activeThreadId === t.id) {
        return;
      }
      setMessages(null);
      // Setting messages to null already turns on the spinner.
      setHasMoreOld(false);
      setHasMoreNew(false);
      setPageRange({ min: 1, max: 1 });
      setTargetMessageId(null);
      setTargetTimestamp(null);
      updateUrl(activePlatform, t.id, undefined, activeCategory); // Use page 1 if no page was requested.
    },
    [activeThreadId, activePlatform, activeCategory, updateUrl],
  );

  const handleSearchNavigate = useCallback(
    async (msgId: number) => {
      try {
        const res = await apiFetch(`/api/jump?messageId=${msgId}`);
        if (res.ok) {
          const info = await res.json();

          setTargetMessageId(msgId.toString());
          setTargetTimestamp(info.timestamp || null);
          setHighlightToken((t) => t + 1);
          // Navigate to the thread/page via URL update
          updateUrl(info.platform, info.threadId, info.page, info.category);
        }
      } catch (e) {
        console.error('Jump failed', e);
      }
    },
    [updateUrl],
  );

  const handleLoadOld = useCallback(() => {
    if (!activeThreadId) {
      return;
    }
    const next = pageRange.max + 1;
    if (activeThreadPageCount && next > activeThreadPageCount) {
      setHasMoreOld(false);
      return;
    }
    setPageRange((prev) => ({ ...prev, max: next }));
    loadMessages(activeThreadId, next, 'older');
  }, [activeThreadId, activeThreadPageCount, pageRange.max, loadMessages]);

  const handleLoadNew = useCallback(() => {
    if (!activeThreadId) {
      return;
    }
    const next = pageRange.min - 1;
    if (next < 1) {
      setHasMoreNew(false);
      return;
    }
    setPageRange((prev) => ({ ...prev, min: next }));
    loadMessages(activeThreadId, next, 'newer');
  }, [activeThreadId, pageRange.min, loadMessages]);

  // --- Effects ---

  // Check for background jobs once on mount.
  useEffect(() => {
    const checkIngest = async () => {
      if (IS_DEMO_MODE || hasCheckedBgIngestRef.current) {
        return;
      }
      hasCheckedBgIngestRef.current = true;

      try {
        const res = await apiFetch('/api/setup/ingest-status');
        if (res.ok) {
          const data = await res.json();
          if (data.isRunning) {
            setShowSetup(true);
          }
        }
      } catch (e) {
        console.error('Failed to check background ingest:', e);
      }
    };

    checkIngest();
  }, []);

  // Reload the threads when the platform or category changes.
  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    let ignore = false;

    async function loadThreads() {
      try {
        const res = await apiFetch(
          `/api/threads?platform=${encodeURIComponent(activePlatform)}&type=${activeCategory}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            setThreads(data.threads);
            setCategoryCounts(data.counts || {});
          }
        }
      } catch (e) {
        console.error('Failed to load threads', e);
        if (!ignore) {
          setThreads([]);
          setCategoryCounts({});
        }
      }
    }
    loadThreads();

    return () => {
      ignore = true;
    };
  }, [activePlatform, activeCategory, router.isReady]);

  // On desktop, put the first thread in the URL if there isn't a selection yet.
  useEffect(() => {
    if (router.isReady && !isMobile && !threadIdParam && threads?.length) {
      updateUrl(activePlatform, threads[0].id, undefined, activeCategory);
    }
  }, [router.isReady, isMobile, threadIdParam, threads, activePlatform, activeCategory, updateUrl]);

  // Load fresh messages when the selected thread or page changes.
  useEffect(() => {
    if (!targetLoadKey || !activeThreadId) {
      return;
    }
    const threadId: string = activeThreadId;

    const controller = new AbortController();
    const requestId = Symbol('loadMessages');
    latestRequestRef.current = requestId;

    console.info(`[Effect] Initializing thread ${threadId} at Page ${startPage}`);

    async function fetchInitialMessages() {
      try {
        const res = await apiFetch(
          `/api/content?threadId=${encodeURIComponent(threadId)}&page=${startPage}&platform=${encodeURIComponent(activePlatform)}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted || latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          if (controller.signal.aborted || latestRequestRef.current !== requestId) {
            return;
          }
          const newMsgs = data.records || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          setMessages(newMsgs);
          setHasMoreNew(startPage > 1);
          setHasMoreOld(activeThreadPageCount ? startPage < activeThreadPageCount : hasData && isFullPage);
          setPageRange({ min: startPage, max: startPage });
        } else {
          setPageLoadFailed(true);
          setMessages([]);
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return;
        }
        console.error(e);
        if (latestRequestRef.current === requestId) {
          setPageLoadFailed(true);
          setMessages([]);
        }
      } finally {
        if (!controller.signal.aborted && latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    fetchInitialMessages();

    return () => {
      controller.abort();
    };
  }, [targetLoadKey, activeThreadId, activePlatform, activeThreadPageCount, startPage]);

  if (!router.isReady) {
    return <div>Loading...</div>;
  }

  // --- Calculated Values ---
  const showThreadList = !isMobile
    ? !(showMedia && windowWidth > 0 && windowWidth < 1150)
    : !activeThread && !showMedia;
  const showThreadContent = !isMobile || (isMobile && !!activeThread && !showMedia);
  const isSidebarVisible = true;
  const collapsed = !showSidebar;
  const isSetupOpen = showSetup || isInitialized === false;

  // Keep showing the loading state while navigation catches up so the UI doesn't flicker.
  // We're still loading in three cases.
  // The thread in the URL hasn't made it into state yet.
  // We're on desktop with no selected thread and the list is still loading.
  // The desktop list arrived, but the first thread hasn't been selected yet.
  const isInitializing =
    (!!threadIdParam && !activeThread && availability[activePlatform]) ||
    (!isMobile && !activeThread && (threads === null || !!threads?.length));

  return (
    <div className={styles.container} data-theme={theme}>
      {IS_DEMO_MODE ? (
        <DemoInfoModal isOpen={showSetup} onClose={() => setShowSetup(false)} />
      ) : (
        isSetupOpen && (
          <SetupModal
            isOpen={isSetupOpen}
            initialStep={isInitialized ? 2 : 0}
            isFirstRun={isInitialized === false}
            onClose={() => setShowSetup(false)}
            onCompleted={() => window.location.reload()}
          />
        )
      )}
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} onNavigate={handleSearchNavigate} />

      {/* Global Header */}
      <div className={styles.topBar}>
        <div className={styles.leftSection}>
          {!isMobile && (
            <button className={styles.iconButton} onClick={() => setShowSidebar(!showSidebar)}>
              <FaBars />
            </button>
          )}
          {isMobile && activeThread && (
            <button
              className={styles.iconButton}
              onClick={() => {
                handleShowMediaChange(false);
                updateUrl(activePlatform);
              }}
            >
              <FaArrowLeft />
            </button>
          )}
          {isMobile && !activeThread && (
            <button className={styles.iconButton} onClick={() => setShowSidebar(!showSidebar)}>
              <FaBars />
            </button>
          )}

          <Link
            aria-label="Back to home"
            className={styles.appTitle}
            href="/"
            prefetch={false}
            onClick={() => {
              handleShowMediaChange(false);
              setTargetMessageId(null);
              setTargetTimestamp(null);
              setIsSearchOpen(false);
            }}
          >
            <span>💬</span>
            <span>MessageHub</span>
          </Link>
        </div>

        <div className={styles.searchSection}>
          <div
            className={`${styles.searchTrigger} ${isMobile ? styles.headerIconBtn : ''}`}
            onClick={() => setIsSearchOpen(true)}
          >
            <FaSearch className={styles.searchTriggerIcon} size={20} />
            <span>Search messages...</span>
          </div>
        </div>

        <div className={styles.themeToggleWrapper}>
          {IS_DEMO_MODE ? (
            <Tooltip content="About Interactive Demo" align="end">
              <button
                className={styles.demoBadge}
                aria-label="About Interactive Demo"
                type="button"
                onClick={() => setShowSetup(true)}
              >
                <span className={styles.demoBadgeDot} />
                <span>Demo</span>
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Setup" align="end">
              <button
                className={`${styles.iconButton} ${styles.headerIconBtn}`}
                aria-label="Setup"
                style={{ marginRight: 8 }}
                onClick={() => setShowSetup(true)}
              >
                <FaCog size={20} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'} align="end">
            <button
              className={`${styles.iconButton} ${styles.headerIconBtn}`}
              aria-label={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              onClick={toggleTheme}
            >
              {!mounted || theme === 'light' ? <FiMoon size={20} /> : <FiSun size={20} />}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Main Body */}
      <div className={styles.bodyContent}>
        <div
          className={`${styles.sidebarWrapper} ${collapsed ? styles.wrapperCollapsed : styles.wrapperExpanded}`}
          style={{
            display: isSidebarVisible ? 'block' : 'none',
          }}
        >
          <Sidebar
            activePlatform={activePlatform}
            availability={availability}
            collapsed={collapsed}
            onPlatformSelect={handlePlatformSelect}
          />
        </div>

        <div className={styles.workspace}>
          {showThreadList && (
            <div className={styles.threadListWrapper} style={{ width: isMobile ? '100%' : '350px' }}>
              <ThreadList
                activePlatform={activePlatform}
                activeCategory={activeCategory}
                categoryCounts={categoryCounts}
                threads={threads || []}
                activeThread={activeThread}
                loading={threads === null}
                onCategoryChange={handleCategoryChange}
                onThreadSelect={handleThreadSelect}
              />
            </div>
          )}

          {showThreadContent && (
            <div className={styles.threadContentWrapper} style={{ flex: 1 }}>
              {pageLoadFailed && <div role="alert">Unable to load this page.</div>}
              <ThreadContent
                activeThread={activeThread}
                messages={messages}
                loading={loading}
                hasMoreOld={hasMoreOld}
                hasMoreNew={hasMoreNew}
                pageRange={pageRange}
                targetMessageId={targetMessageId}
                targetTimestamp={targetTimestamp}
                highlightToken={highlightToken}
                timelineReset={targetLoadKey}
                initializing={isInitializing}
                showMedia={showMedia}
                onNavigate={handleThreadNavigate}
                onStartReached={handleLoadOld}
                onEndReached={handleLoadNew}
                onShowMediaChange={handleShowMediaChange}
              />
            </div>
          )}

          <div
            className={styles.mediaPanelWrapper}
            style={{
              width: showMedia ? (isMobile ? '100%' : '400px') : '0px',
              borderLeft: showMedia ? '1px solid var(--border-color)' : 'none',
              flexShrink: 0,
            }}
          >
            <MediaPanel
              key={activeThread?.id}
              isOpen={showMedia}
              platform={activeThread?.platform || ''}
              threadId={activeThread?.id || ''}
              onClose={() => handleShowMediaChange(false)}
              onMediaClick={handleSearchNavigate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
