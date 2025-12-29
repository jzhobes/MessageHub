import React, { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaArrowLeft, FaBars, FaCog, FaSearch } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';

import styles from '@/components/Layout.module.css';
import MediaPanel from '@/components/MediaPanel';
import SearchModal from '@/components/modals/SearchModal';
import SetupModal from '@/components/modals/SetupModal';

import { useTheme } from '@/hooks/useTheme';

import { useApp } from '@/context/AppContext';
import { getPlatformLabel, PlatformMap } from '@/lib/shared/platforms';
import { ContentRecord, Thread } from '@/lib/shared/types';
import Sidebar from '@/sections/Sidebar';
import ThreadContent from '@/sections/ThreadContent';
import ThreadList from '@/sections/ThreadList';

const platformPreference = ['facebook', 'instagram', 'google_chat', 'google_mail', 'google_voice'];

export default function Home() {
  const router = useRouter();
  const prevWidthRef = useRef(0);

  // --- State ---
  const [activePlatform, setActivePlatform] = useState<string>('facebook');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ContentRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [targetTimestamp, setTargetTimestamp] = useState<number | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showMedia, setShowMedia] = useState(false);

  // Layout State
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);
  const [highlightToken, setHighlightToken] = useState(0);
  // Availability & Router State
  const { isInitialized, availability } = useApp();
  const [isRouterReady, setIsRouterReady] = useState(false);

  // Pagination State
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('message');

  const { theme, toggleTheme, mounted } = useTheme();

  const resolvePlatform = useCallback((candidate: string | undefined, availableMap: Record<string, boolean>) => {
    if (candidate && availableMap[candidate]) {
      return candidate;
    }

    for (const p of platformPreference) {
      if (availableMap[p]) {
        return p;
      }
    }
    // Fallback to candidate or default if nothing is available
    return candidate || platformPreference[0];
  }, []);

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

      router.push(
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

  const latestRequestRef = useRef<symbol | null>(null);

  // Load Messages Helper
  const loadMessages = useCallback(
    async (threadId: string, pageNum: number, mode: 'reset' | 'older' | 'newer') => {
      if (!activeThread || activeThread.id !== threadId) {
        return;
      }

      const requestId = Symbol('loadMessages');
      latestRequestRef.current = requestId;

      if (mode === 'reset') {
        setMessages(null);
      } else {
        setLoading(true);
      }

      try {
        const res = await fetch(
          `/api/content?threadId=${encodeURIComponent(threadId)}&page=${pageNum}&platform=${encodeURIComponent(activePlatform)}`,
        );

        // Drop responses for superseded requests
        if (latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.records || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          if (mode === 'reset') {
            setMessages(newMsgs);
            setHasMoreNew(pageNum > 1);
            setHasMoreOld(hasData && isFullPage);
            setPageRange({ min: pageNum, max: pageNum });
          } else if (mode === 'older') {
            setMessages((prev) => [...(prev || []), ...newMsgs]);
            if (activeThread.pageCount) {
              setHasMoreOld(pageNum < activeThread.pageCount);
            } else {
              setHasMoreOld(hasData && isFullPage);
            }
            setPageRange((prev) => ({ ...prev, max: pageNum }));
          } else if (mode === 'newer') {
            setMessages((prev) => [...newMsgs, ...(prev || [])]);
            setHasMoreNew(pageNum > 1);
            setPageRange((prev) => ({ ...prev, min: pageNum }));
          }
        } else {
          // Handle error state
          if (mode === 'reset') {
            setMessages([]); // Clear spinner
          }
          if (mode === 'older') {
            setHasMoreOld(false);
          }
          if (mode === 'newer') {
            setHasMoreNew(false);
          }
        }
      } catch (e) {
        console.error(e);
        if (mode === 'reset') {
          setMessages([]);
        } // Clear spinner on throw
      } finally {
        // Only turn off loading if this is still the latest request
        if (latestRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [activePlatform, activeThread],
  );

  const handlePlatformSelect = useCallback(
    (p: string) => {
      const safePlatform = resolvePlatform(p, availability);
      const defaultCat = safePlatform === 'google_mail' ? 'inbox' : 'message';

      // 1. Same platform/category selection
      if (safePlatform === activePlatform && activeCategory === defaultCat) {
        if (isMobile) {
          if (activeThread) {
            setActiveThread(null);
            setMessages(null);
            lastLoadedRef.current = '';
            updateUrl(safePlatform, undefined, undefined, defaultCat);
          }
          setShowSidebar(false);
        }
        return;
      }

      // 2. Changing Platform or Category:
      // Full reset. Threads will be re-fetched by Effect 4 because activePlatform or activeCategory will change.
      setThreads(null);
      setActiveThread(null);
      setMessages(null);
      lastLoadedRef.current = '';
      if (activeCategory !== defaultCat) {
        setActiveCategory(defaultCat);
      }
      updateUrl(safePlatform, undefined, undefined, defaultCat);

      if (isMobile) {
        setShowSidebar(false);
      }
    },
    [availability, resolvePlatform, updateUrl, isMobile, activePlatform, activeCategory, activeThread],
  );

  const handleCategoryChange = useCallback(
    (cat: string) => {
      // 1. Same category selection
      if (cat === activeCategory) {
        if (isMobile && activeThread) {
          setActiveThread(null);
          setMessages(null);
          lastLoadedRef.current = '';
          updateUrl(activePlatform, undefined, undefined, cat);
          return;
        }
        return;
      }

      // 2. Changing category
      setActiveCategory(cat); // Trigger Effect 4
      setThreads(null);
      setActiveThread(null);
      setMessages(null);
      lastLoadedRef.current = '';
      updateUrl(activePlatform, undefined, undefined, cat);
    },
    [activePlatform, updateUrl, activeCategory, activeThread, isMobile],
  );

  const handleThreadSelect = useCallback(
    (t: Thread) => {
      if (activeThread?.id === t.id) {
        return;
      }
      setActiveThread({
        ...t,
        platform: activePlatform,
      });
      setMessages(null);
      // Don't set loading(true) here, as messages=null handles the spinner
      setHasMoreOld(false);
      setHasMoreNew(false);
      setPageRange({ min: 1, max: 1 });
      setTargetMessageId(null);
      setTargetTimestamp(null);
      updateUrl(activePlatform, t.id, undefined, activeCategory); // Page undefined -> 1
    },
    [activeThread, activePlatform, activeCategory, updateUrl],
  );

  const handleSearchNavigate = useCallback(
    async (msgId: number) => {
      try {
        const res = await fetch(`/api/jump?messageId=${msgId}`);
        if (res.ok) {
          const info = await res.json();

          setTargetMessageId(msgId.toString());
          setTargetTimestamp(info.timestamp || null);
          setHighlightToken((t) => t + 1);
          // Map raw platform to display name before updating URL
          const displayPlatform = getPlatformLabel(info.platform);
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
    if (!activeThread) {
      return;
    }
    const next = pageRange.max + 1;
    if (activeThread.pageCount && next > activeThread.pageCount) {
      setHasMoreOld(false);
      return;
    }
    setPageRange((prev) => ({ ...prev, max: next }));
    loadMessages(activeThread.id, next, 'older');
  }, [activeThread, pageRange.max, loadMessages]);

  const handleLoadNew = useCallback(() => {
    if (!activeThread) {
      return;
    }
    const next = pageRange.min - 1;
    if (next < 1) {
      setHasMoreNew(false);
      return;
    }
    setPageRange((prev) => ({ ...prev, min: next }));
    loadMessages(activeThread.id, next, 'newer');
  }, [activeThread, pageRange.min, loadMessages]);

  // --- Effects ---

  // 1. Router Ready Check
  useEffect(() => {
    if (router.isReady) {
      setIsRouterReady(true);
    }
  }, [router.isReady]);

  // 2. Initialize Backend Status
  useEffect(() => {
    if (isInitialized === false) {
      setShowSetup(true);
    }

    if (availability) {
      const safePlatform = resolvePlatform(activePlatform, availability);
      if (safePlatform !== activePlatform) {
        setActivePlatform(safePlatform);
      }
    }
  }, [activePlatform, resolvePlatform, isInitialized, availability]);

  // 3. Responsive Check
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setWindowWidth(width);
      const mobile = width < 768;
      setIsMobile(mobile);

      // Auto-collapse sidebar logic
      // When media is open, we need more room, so we collapse sidebar at 1350px instead of 1024px
      const threshold = showMedia ? 1350 : 1024;
      const prevWidth = prevWidthRef.current;

      if (prevWidth > 0) {
        if (prevWidth >= threshold && width < threshold) {
          setShowSidebar(false);
        } else if (prevWidth < threshold && width >= threshold) {
          setShowSidebar(true);
        }
      }
      prevWidthRef.current = width;
    };

    const initialWidth = window.innerWidth;
    prevWidthRef.current = initialWidth;

    handleResize();
    const threshold = showMedia ? 1350 : 1024;
    if (initialWidth < threshold) {
      setShowSidebar(false);
    } else {
      setShowSidebar(true);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showMedia]);

  // Sync sidebar state when Media Panel is toggled manually
  useEffect(() => {
    if (!mounted) {
      return;
    }
    const width = window.innerWidth;
    if (showMedia) {
      if (width < 1350) {
        setShowSidebar(false);
      }
    } else {
      if (width >= 1024) {
        setShowSidebar(true);
      }
    }
  }, [showMedia, mounted]);

  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  // ...
  // 4. Load Threads on activePlatform change
  useEffect(() => {
    if (!isRouterReady) {
      return;
    }

    let ignore = false;

    async function loadThreads() {
      // Set to null while fetching to trigger loading state
      setThreads(null);
      try {
        const res = await fetch(`/api/threads?platform=${encodeURIComponent(activePlatform)}&type=${activeCategory}`);
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            // Data now contains { threads, counts }
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
  }, [activePlatform, activeCategory, isRouterReady]);

  // 5. Sync state with URL params on mount/update (Navigation)
  useEffect(() => {
    if (!isRouterReady) {
      return;
    }

    const platformParam = router.query.platform as string;
    const threadIdParam = router.query.threadId as string;
    const typeParam = router.query.type as string;

    const safePlatform = resolvePlatform(platformParam || activePlatform, availability);

    // If URL contains an invalid/unavailable platform, rewrite it to the first valid one
    if (safePlatform !== activePlatform) {
      setActivePlatform(safePlatform);
      setActiveThread(null);
      setMessages(null);
      setThreads(null);
      // If no type param, set default for new platform
      const defaultCat = safePlatform === 'google_mail' ? 'inbox' : 'message';
      setActiveCategory(typeParam || defaultCat);
      return;
    }

    const defaultCat = activePlatform === 'google_mail' ? 'inbox' : 'message';

    // Auto-close Media Panel if switching to a platform that doesn't support it (e.g., Gmail)
    if (activePlatform === 'google_mail' && showMedia) {
      setShowMedia(false);
    }
    const effectiveType = typeParam || defaultCat;
    if (effectiveType !== activeCategory) {
      setActiveCategory(effectiveType);
    }

    if (threads?.length) {
      if (threadIdParam) {
        if (threadIdParam !== activeThread?.id) {
          const target = threads.find((t) => t.id === threadIdParam);
          if (target) {
            setActiveThread({
              ...target,
              platform: safePlatform,
            });
          }
        }
      } else if (!isMobile) {
        // Auto-select first thread on desktop
        handleThreadSelect(threads[0]);
      } else if (activeThread) {
        setActiveThread(null);
      }
    }
  }, [
    isRouterReady,
    router.query,
    activePlatform,
    activeThread,
    activeCategory,
    threads,
    resolvePlatform,
    availability,
    updateUrl,
    handleThreadSelect,
    isMobile,
  ]);

  const lastLoadedRef = useRef<string>('');

  // 6. Initial Load / Reset Messages when Active Thread changes
  useEffect(() => {
    if (!activeThread?.id) {
      return;
    }

    const threadIdParam = router.query.threadId as string | undefined;
    if (threadIdParam && threadIdParam !== activeThread.id) {
      return;
    }

    const pageParam = router.query.page;
    const startPage = pageParam ? parseInt(pageParam as string, 10) : 1;
    const loadKey = `${activeThread.id}-${startPage}`;

    if (lastLoadedRef.current === loadKey) {
      return;
    }

    console.info(`[Effect] Initializing thread ${activeThread.id} at Page ${startPage}`);
    lastLoadedRef.current = loadKey;
    setPageRange({ min: startPage, max: startPage });
    loadMessages(activeThread.id, startPage, 'reset');
  }, [activeThread?.id, router.query.page, router.query.threadId, loadMessages]);

  if (!isRouterReady) {
    return <div>Loading...</div>;
  }

  // --- Calculated Values ---
  const showThreadList = !isMobile
    ? !(showMedia && windowWidth > 0 && windowWidth < 1150)
    : !activeThread && !showMedia;
  const showThreadContent = !isMobile || (isMobile && !!activeThread && !showMedia);
  const isSidebarVisible = true;
  const collapsed = !showSidebar;

  // Derive initialization state to prevent flickering during transitions
  // We are initializing if:
  // 1. A threadId is in the URL but we haven't loaded it into state yet
  // 2. We're on desktop, no thread is active, and we're currently loading threads (threads === null)
  // 3. We're on desktop, no thread is active, but threads have arrived and are waiting to be auto-selected (threads.length > 0)
  const isInitializing =
    (!!router.query.threadId && !activeThread && availability[activePlatform]) ||
    (!isMobile && !activeThread && (threads === null || !!threads?.length));

  return (
    <div className={styles.container} data-theme={theme}>
      <SetupModal
        isOpen={showSetup}
        initialStep={isInitialized ? 2 : 0}
        isFirstRun={isInitialized === false}
        onClose={() => setShowSetup(false)}
        onCompleted={() => window.location.reload()}
      />
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
                setShowMedia(false);
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
            onClick={(e) => {
              // Force full reload to guarantee clean state
              e.preventDefault();
              window.location.href = '/';
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
          <button
            className={`${styles.iconButton} ${styles.headerIconBtn}`}
            title="Setup"
            style={{ marginRight: 8 }}
            onClick={() => setShowSetup(true)}
          >
            <FaCog size={20} />
          </button>
          <button
            className={`${styles.iconButton} ${styles.headerIconBtn}`}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            onClick={toggleTheme}
          >
            {!mounted || theme === 'light' ? <FiMoon size={20} /> : <FiSun size={20} />}
          </button>
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
                initializing={isInitializing}
                showMedia={showMedia}
                onStartReached={handleLoadOld}
                onEndReached={handleLoadNew}
                onShowMediaChange={setShowMedia}
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
              onClose={() => setShowMedia(false)}
              onMediaClick={handleSearchNavigate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
