import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import styles from '../styles/index.module.css';
import { Message, Thread } from '../types';
import Sidebar from '../sections/Sidebar';
import ThreadList from '../sections/ThreadList';
import ChatWindow from '../sections/ChatWindow';

export default function Home() {
  const router = useRouter();

  const [activePlatform, setActivePlatform] = useState<string>('Facebook');
  const [searchQuery, setSearchQuery] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(false);

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
        // If current active platform is now disabled, switch to first available
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

  // Sync state with URL params on mount/update
  useEffect(() => {
    if (!isRouterReady) {
      return;
    }

    const platformParam = router.query.platform as string;
    const threadIdParam = router.query.threadId as string;

    // 1. Handle Platform Change
    if (platformParam && platformParam !== activePlatform) {
      setActivePlatform(platformParam);
      return;
    }

    // 2. Handle Thread Change (Same Platform)
    if (threads.length > 0) {
      // Case A: URL has a thread ID
      if (threadIdParam) {
        if (threadIdParam !== activeThread?.id) {
          const target = threads.find((t) => t.id === threadIdParam);
          if (target) {
            setActiveThread(target);
          }
        }
      }
      // Case B: URL has NO thread ID (Back to list)
      else if (activeThread) {
        setActiveThread(null);
      }
    }
  }, [isRouterReady, router.query, activePlatform, activeThread, threads]);

  const updateUrl = (platform: string, threadId?: string) => {
    const query: Record<string, string> = { platform };
    if (threadId) {
      query.threadId = threadId;
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
      // Clear threads immediately to avoid showing stale platform data
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
  };

  const handleThreadSelect = (t: Thread) => {
    if (activeThread?.id === t.id) {
      return;
    }
    setMessages([]);
    setLoading(true);
    setHasMore(false);
    updateUrl(activePlatform, t.id);
  };

  // Load Messages for Thread
  useEffect(() => {
    if (!activeThread) {
      return;
    }

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

    setMessages([]);
    setPage(1);
    loadMessages(activeThread.id, 1, true); // Reset
  }, [activeThread, activePlatform]);

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
    const nextPage = page + 1;
    setPage(nextPage);
    loadMessagesManual(activeThread.id, nextPage);
  };

  if (!isRouterReady) {
    return <div>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <Sidebar activePlatform={activePlatform} onPlatformSelect={handlePlatformSelect} availability={availability} />

      <ThreadList activePlatform={activePlatform} threads={threads} activeThread={activeThread} loading={loadingThreads} onThreadSelect={handleThreadSelect} />

      <ChatWindow
        activeThread={activeThread}
        messages={messages}
        loading={loading}
        hasMore={hasMore}
        page={page}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLoadMore={handleLoadMore}
        activePlatform={activePlatform}
      />
    </div>
  );
}
