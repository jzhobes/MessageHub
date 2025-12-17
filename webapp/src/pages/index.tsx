import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaArrowLeft, FaBars, FaSearch } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';

import GlobalSearch from '@/components/Search/GlobalSearch';
import { useTheme } from '@/hooks/useTheme';
import ChatWindow from '@/sections/ChatWindow';
import Sidebar from '@/sections/Sidebar';
import ThreadList from '@/sections/ThreadList';
import { Message, Thread } from '@/lib/shared/types';

import styles from '@/styles/Layout.module.css';

// Convert raw DB platform identifiers to UI display names
function mapPlatform(raw: string): string {
  switch (raw) {
    case 'google_chat':
      return 'Google Chat';
    case 'google_voice':
      return 'Google Voice';
    case 'facebook':
      return 'Facebook';
    case 'instagram':
      return 'Instagram';
    default:
      return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

const platformPreference = ['Facebook', 'Instagram', 'Google Chat', 'Google Voice'];

export default function Home() {
  const router = useRouter();
  const prevWidthRef = useRef(0);

  // --- State ---
  const [activePlatform, setActivePlatform] = useState<string>('Facebook');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);

  // Layout State
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [highlightToken, setHighlightToken] = useState(0);
  // Availability & Router State
  const [availability, setAvailability] = useState<Record<string, boolean>>({
    Facebook: true,
    Instagram: true,
    'Google Chat': true,
    'Google Voice': true,
  });
  const [isRouterReady, setIsRouterReady] = useState(false);

  // Pagination State
  const [pageRange, setPageRange] = useState({ min: 1, max: 1 });
  const [hasMoreOld, setHasMoreOld] = useState(false);
  const [hasMoreNew, setHasMoreNew] = useState(false);

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
    (platform: string, threadId?: string, pageNum?: number) => {
      const query: Record<string, string> = { platform };
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
    [router],
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
        const res = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}&page=${pageNum}&platform=${encodeURIComponent(activePlatform)}`);

        // Drop responses for superseded requests
        if (latestRequestRef.current !== requestId) {
          return;
        }

        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.messages || [];
          const hasData = newMsgs.length > 0;
          const isFullPage = newMsgs.length >= 100;

          if (mode === 'reset') {
            setMessages(newMsgs);
            setHasMoreNew(pageNum > 1);
            setHasMoreOld(hasData && isFullPage);
            setPageRange({ min: pageNum, max: pageNum });
          } else if (mode === 'older') {
            setMessages((prev) => [...(prev || []), ...newMsgs]);
            if (activeThread.file_count) {
              setHasMoreOld(pageNum < activeThread.file_count);
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
      updateUrl(safePlatform, undefined);
      if (isMobile) {
        setShowSidebar(false); // Close sidebar on mobile after selection
      }
    },
    [availability, resolvePlatform, updateUrl, isMobile],
  );

  const handleThreadSelect = useCallback(
    (t: Thread) => {
      if (activeThread?.id === t.id) {
        return;
      }
      setMessages(null);
      // Don't set loading(true) here, as messages=null handles the spinner
      setHasMoreOld(false);
      setHasMoreNew(false);
      setPageRange({ min: 1, max: 1 });
      setTargetMessageId(null);
      updateUrl(activePlatform, t.id); // Page undefined -> 1
    },
    [activeThread, activePlatform, updateUrl],
  );

  const handleSearchNavigate = useCallback(
    async (msgId: number) => {
      try {
        const res = await fetch(`/api/jump?messageId=${msgId}`);
        if (res.ok) {
          const info = await res.json();

          setTargetMessageId(msgId.toString());
          setHighlightToken((t) => t + 1);
          // Map raw platform to display name before updating URL
          const displayPlatform = mapPlatform(info.platform);
          // Navigate to the thread/page via URL update
          updateUrl(displayPlatform, info.threadId, info.page);
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
    if (activeThread.file_count && next > activeThread.file_count) {
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
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        setAvailability(data);
        const safePlatform = resolvePlatform(activePlatform, data);
        if (safePlatform !== activePlatform) {
          setActivePlatform(safePlatform);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch status', err);
      });
  }, [activePlatform, resolvePlatform]);

  // 3. Responsive Check
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const mobile = width < 768;
      setIsMobile(mobile);

      // Auto-collapse sidebar logic on threshold cross (1024px)
      const prevWidth = prevWidthRef.current;
      if (prevWidth > 0) {
        if (prevWidth >= 1024 && width < 1024) {
          setShowSidebar(false);
        } else if (prevWidth < 1024 && width >= 1024) {
          setShowSidebar(true);
        }
      }
      prevWidthRef.current = width;
    };

    const initialWidth = window.innerWidth;
    prevWidthRef.current = initialWidth;

    handleResize();
    if (initialWidth < 1024) {
      setShowSidebar(false);
    } else {
      setShowSidebar(true);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
        const res = await fetch(`/api/threads?platform=${encodeURIComponent(activePlatform)}`);
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            setThreads(data);
          }
        }
      } catch (e) {
        console.error('Failed to load threads', e);
        if (!ignore) {
          setThreads([]);
        }
      }
    }
    loadThreads();

    return () => {
      ignore = true;
    };
  }, [activePlatform, isRouterReady]);

  // 5. Sync state with URL params on mount/update (Navigation)
  useEffect(() => {
    if (!isRouterReady) {
      return;
    }

    const platformParam = router.query.platform as string;
    const threadIdParam = router.query.threadId as string;

    const safePlatform = resolvePlatform(platformParam || activePlatform, availability);

    // If URL contains an invalid/unavailable platform, rewrite it to the first valid one
    if (platformParam && platformParam !== safePlatform) {
      updateUrl(safePlatform);
      return;
    }

    if (safePlatform !== activePlatform) {
      setActivePlatform(safePlatform);
      setActiveThread(null);
      setMessages(null);
      return;
    }

    if (threads?.length) {
      if (threadIdParam) {
        if (threadIdParam !== activeThread?.id) {
          const target = threads.find((t) => t.id === threadIdParam);
          if (target) {
            setActiveThread(target);
          }
        }
      } else if (activeThread) {
        setActiveThread(null);
      }
    }
  }, [isRouterReady, router.query, activePlatform, activeThread, threads, resolvePlatform, availability, updateUrl]);

  // 6. Initial Load / Reset Messages when Active Thread changes
  useEffect(() => {
    if (!activeThread) {
      return;
    }

    const threadIdParam = router.query.threadId as string | undefined;
    if (threadIdParam && threadIdParam !== activeThread.id) {
      return;
    }

    const pageParam = router.query.page;
    const startPage = pageParam ? parseInt(pageParam as string, 10) : 1;

    console.info(`Initializing at Page ${startPage}`);
    setPageRange({ min: startPage, max: startPage });
    loadMessages(activeThread.id, startPage, 'reset');
  }, [activeThread, router.query.page, router.query.threadId, loadMessages]);

  if (!isRouterReady) {
    return <div>Loading...</div>;
  }

  // --- Calculated Values ---
  const showThreadList = !isMobile || (isMobile && !activeThread);
  const showChatWindow = !isMobile || (isMobile && !!activeThread);
  const isSidebarVisible = true;
  const collapsed = !showSidebar;

  return (
    <div className={styles.container} data-theme={theme}>
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} onNavigate={handleSearchNavigate} />

      {/* Global Header */}
      <div className={styles.topBar}>
        <div className={styles.leftSection}>
          {!isMobile && (
            <button className={styles.iconButton} onClick={() => setShowSidebar(!showSidebar)}>
              <FaBars />
            </button>
          )}
          {isMobile && activeThread && (
            <button className={styles.iconButton} onClick={() => updateUrl(activePlatform)}>
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
          <div className={`${styles.searchTrigger} ${isMobile ? styles.headerIconBtn : ''}`} onClick={() => setIsSearchOpen(true)}>
            <FaSearch className={styles.searchTriggerIcon} size={20} />
            <span>Search messages...</span>
          </div>
        </div>

        <div className={styles.themeToggleWrapper}>
          <button className={`${styles.iconButton} ${styles.headerIconBtn}`} onClick={toggleTheme} title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
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
          <Sidebar activePlatform={activePlatform} onPlatformSelect={handlePlatformSelect} availability={availability} collapsed={collapsed} />
        </div>

        <div className={styles.workspace}>
          {showThreadList && (
            <div className={styles.threadListWrapper} style={{ width: isMobile ? '100%' : '350px' }}>
              <ThreadList activePlatform={activePlatform} threads={threads || []} activeThread={activeThread} loading={threads === null} onThreadSelect={handleThreadSelect} />
            </div>
          )}

          {showChatWindow && (
            <div className={styles.chatWindowWrapper} style={{ flex: 1 }}>
              <ChatWindow
                activeThread={activeThread}
                messages={messages}
                loading={loading}
                hasMoreOld={hasMoreOld}
                hasMoreNew={hasMoreNew}
                pageRange={pageRange}
                onStartReached={handleLoadOld}
                onEndReached={handleLoadNew}
                activePlatform={activePlatform}
                targetMessageId={targetMessageId}
                highlightToken={highlightToken}
                initializing={!!router.query.threadId && !activeThread}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
