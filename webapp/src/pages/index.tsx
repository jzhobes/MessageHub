import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { FaSearch, FaArrowLeft, FaBars } from 'react-icons/fa';
import styles from '../styles/Layout.module.css';
import { Message, Thread } from '../types';
import Sidebar from '../sections/Sidebar';
import ThreadList from '../sections/ThreadList';
import ChatWindow from '../sections/ChatWindow';
import GlobalSearch from '../components/Search/GlobalSearch';

export default function Home() {
  const router = useRouter();

  const [activePlatform, setActivePlatform] = useState<string>('Facebook');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Navigation State

  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);

  // Layout State
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // Platform Availability State
  const [availability, setAvailability] = useState<Record<string, boolean>>({
    Facebook: true,
    Instagram: true,
    'Google Chat': true,
    'Google Voice': false,
  });

  // Check backend status on mount
  useEffect(() => {
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        setAvailability(data);
        if (!data[activePlatform]) {
          if (data['Facebook']) {
            setActivePlatform('Facebook');
          } else if (data['Instagram']) {
            setActivePlatform('Instagram');
          } else if (data['Google Chat']) {
            setActivePlatform('Google Chat');
          }
        }
      })
      .catch((err) => console.error('Failed to fetch status', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isRouterReady, setIsRouterReady] = useState(false);

  useEffect(() => {
    if (router.isReady) {
      setIsRouterReady(true);
    }
  }, [router.isReady]);

  const prevWidthRef = useRef(0);

  // Responsive Check
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const mobile = width < 768;
      setIsMobile(mobile);

      // Auto-collapse sidebar logic on threshold cross (1024px)
      // Only trigger if we crossed the boundary to avoid locking user state
      const prevWidth = prevWidthRef.current;
      if (prevWidth > 0) {
        // Skip on first mount (already handled by initial check logic below)
        if (prevWidth >= 1024 && width < 1024) {
          setShowSidebar(false); // Collapse
        } else if (prevWidth < 1024 && width >= 1024) {
          setShowSidebar(true); // Expand
        }
      }
      prevWidthRef.current = width;
    };

    // Initial check
    const initialWidth = window.innerWidth;
    prevWidthRef.current = initialWidth;

    handleResize(); // Set isMobile
    if (initialWidth < 1024) {
      setShowSidebar(false);
    } else {
      setShowSidebar(true);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync state with URL params on mount/update
  useEffect(() => {
    if (!isRouterReady) {
      return;
    }

    const platformParam = router.query.platform as string;
    const threadIdParam = router.query.threadId as string;

    if (platformParam && platformParam !== activePlatform) {
      setActivePlatform(platformParam);
      setActiveThread(null);
      setMessages([]);
      return;
    }

    if (threads.length > 0) {
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
  }, [isRouterReady, router.query, activePlatform, activeThread, threads]);

  const updateUrl = (platform: string, threadId?: string, pageNum?: number) => {
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
  };

  // Load Threads
  useEffect(() => {
    if (!isRouterReady) {
      return;
    }

    let ignore = false;

    async function loadThreads() {
      setThreads([]);
      setLoadingThreads(true);
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
      } finally {
        if (!ignore) {
          setLoadingThreads(false);
        }
      }
    }
    loadThreads();

    return () => {
      ignore = true;
    };
  }, [activePlatform, isRouterReady]);

  const handlePlatformSelect = (p: string) => {
    updateUrl(p, undefined);
    setActivePlatform(p); // Optimistic update
    setActiveThread(null);
    setMessages([]);
    if (isMobile) {
      setShowSidebar(false); // Close sidebar on mobile after selection
    }
  };

  const handleThreadSelect = (t: Thread) => {
    if (activeThread?.id === t.id) {
      return;
    }
    setMessages([]);
    setLoading(true);
    setHasMore(false);
    // setPendingPage(null); // Removed
    setTargetMessageId(null);
    updateUrl(activePlatform, t.id); // Page undefined -> 1
  };

  const handleSearchNavigate = async (threadId: string, platform: string, msgId: number) => {
    try {
      const res = await fetch(`/api/jump?messageId=${msgId}`);
      if (res.ok) {
        const info = await res.json();

        setTargetMessageId(msgId.toString());
        // Navigate to the thread/page via URL update
        updateUrl(info.platform, info.threadId, info.page);
      }
    } catch (e) {
      console.error('Jump failed', e);
    }
  };

  // Load Messages for Thread
  useEffect(() => {
    if (!activeThread) {
      return;
    }

    const pageParam = router.query.page;
    const startPage = pageParam ? parseInt(pageParam as string, 10) : 1;
    // Ensure internal state matches URL
    setPage(startPage);

    const loadMessages = async (threadId: string, pageNum: number, reset: boolean) => {
      setLoading(true);

      try {
        const res = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}&page=${pageNum}&platform=${encodeURIComponent(activePlatform)}`);
        if (res.ok) {
          const data = await res.json();
          const newMsgs = data.messages || [];

          if (reset) {
            setMessages(newMsgs);
          } else {
            setMessages((prev) => [...prev, ...newMsgs]);
          }
          setHasMore(newMsgs.length > 0);
        } else {
          setHasMore(false);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    loadMessages(activeThread.id, startPage, true); // Reset
  }, [activeThread, activePlatform, router.query.page]);

  const loadMessagesManual = async (threadId: string, pageNum: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}&page=${pageNum}&platform=${encodeURIComponent(activePlatform)}`);
      if (res.ok) {
        const data = await res.json();
        const newMsgs = data.messages || [];
        setMessages((prev) => [...prev, ...newMsgs]);
        setHasMore(newMsgs.length > 0);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (!activeThread) {
      return;
    }
    if (activeThread.file_count && page >= activeThread.file_count) {
      setHasMore(false);
      return;
    }
    const nextPage = page + 1;
    setPage(nextPage);
    loadMessagesManual(activeThread.id, nextPage);
  };

  // Theme State
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved) {
      setTheme(saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
  };

  if (!isRouterReady) {
    return <div>Loading...</div>;
  }

  // Mobile View Logic
  const showThreadList = !isMobile || (isMobile && !activeThread);
  const showChatWindow = !isMobile || (isMobile && !!activeThread);

  // Sidebar Visibility Logic
  const isSidebarVisible = true;

  // Collapsed State Logic
  const collapsed = !showSidebar;

  return (
    <div className={styles.container} data-theme={theme}>
      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} activeThreadId={activeThread?.id} onNavigate={handleSearchNavigate} />

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

          <div className={styles.appTitle}>
            <span>💬</span>
            <span>MessageHub</span>
          </div>
        </div>

        <div className={styles.searchSection}>
          <div className={styles.searchTrigger} onClick={() => setIsSearchOpen(true)}>
            <FaSearch className={styles.searchTriggerIcon} />
            <span>Search messages...</span>
          </div>
        </div>

        <div style={{ width: 40 }} />
      </div>

      {/* Main Body */}
      <div className={styles.bodyContent}>
        <div
          className={`${styles.sidebarWrapper} ${collapsed ? styles.wrapperCollapsed : styles.wrapperExpanded}`}
          style={{
            display: isSidebarVisible ? 'block' : 'none',
          }}
        >
          <Sidebar activePlatform={activePlatform} onPlatformSelect={handlePlatformSelect} availability={availability} theme={theme} onToggleTheme={toggleTheme} collapsed={collapsed} />
        </div>

        <div className={styles.workspace}>
          {showThreadList && (
            <div className={styles.threadListWrapper} style={{ width: isMobile ? '100%' : '350px' }}>
              <ThreadList activePlatform={activePlatform} threads={threads} activeThread={activeThread} loading={loadingThreads} onThreadSelect={handleThreadSelect} />
            </div>
          )}

          {showChatWindow && (
            <div className={styles.chatWindowWrapper} style={{ flex: 1 }}>
              <ChatWindow
                activeThread={activeThread}
                messages={messages}
                loading={loading}
                hasMore={hasMore}
                page={page}
                onLoadMore={handleLoadMore}
                activePlatform={activePlatform}
                targetMessageId={targetMessageId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
