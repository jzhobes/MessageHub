import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { FaFacebook, FaInstagram, FaPhone, FaSpinner } from 'react-icons/fa';
import { SiGooglechat } from 'react-icons/si';
import styles from '../styles/index.module.css';
import MessageItem from '../components/MessageItem';
import { Message, QuotedMessageMetadata, Thread } from '../types';

export default function Home() {
  const router = useRouter();

  const [activePlatform, setActivePlatform] = useState<string>('Facebook');
  const [searchQuery, setSearchQuery] = useState('');
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
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
      // We return here because activePlatform change will trigger the loadThreads effect
      // and we want to defer thread selection until threads are loaded?
      // Actually, if we change platform, we need to load threads first.
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

  // Autoload effect
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading]);

  const filteredMessages = messages.filter((msg) => {
    if (!msg.content) {
      return !searchQuery; // Hide media-only if searching text
    }
    if (/reacted\s+.+?\s+to your message/i.test(msg.content)) {
      return false;
    }
    if (searchQuery) {
      return msg.content.toLowerCase().includes(searchQuery.toLowerCase()) || msg.sender_name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  // Scroll to message logic
  const handleQuoteClick = (quoteMetadata: QuotedMessageMetadata | undefined) => {
    if (!quoteMetadata) {
      return;
    }

    // Use filteredMessages since that's what's visible? Or messages (all loaded)?
    // Use messages to catch even if filtered out? But filter logic is for search.
    // If not visible, we can't scroll to it.
    // Let's search 'filteredMessages' (rendered list) first.

    // Heuristic: Match content AND sender
    const match = filteredMessages.find((m) => {
      const quoteName = quoteMetadata.creator?.name;
      // Check sender match (handling "You" logic roughly by name match)
      const senderMatch = m.sender_name === quoteName;

      return senderMatch && m.content === quoteMetadata.text;
    });

    if (match) {
      const elId = `msg-${match.id || match.timestamp_ms}`;
      const el = document.getElementById(elId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        el.style.transition = 'background-color 0.5s';
        const originalBg = el.style.backgroundColor;
        el.style.backgroundColor = 'rgba(255, 215, 0, 0.2)';
        setTimeout(() => {
          el.style.backgroundColor = originalBg;
        }, 1000);
      } else {
        // Maybe it's in the list but not rendered (virtualization)?
        // But we don't use virtualization yet.
        console.log('Element not found in DOM');
      }
    } else {
      console.log('Message not found in loaded history');
      // Could trigger loadMore here automatically? Too complex for now.
    }
  };

  if (!isRouterReady) {
    return <div>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      {/* Column 1: Platforms */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarTitle}>Virtual Me</div>
        {[
          { name: 'Facebook', icon: <FaFacebook size={20} color="#1877F2" /> },
          { name: 'Instagram', icon: <FaInstagram size={18} color="#E4405F" /> },
          { name: 'Google Chat', icon: <SiGooglechat size={18} color="#00AC47" /> },
          { name: 'Google Voice', icon: <FaPhone size={18} color="#34A853" /> },
        ].map((p) => (
          <div key={p.name} className={`${styles.navItem} ${activePlatform === p.name ? styles.navItemActive : ''}`} onClick={() => handlePlatformSelect(p.name)}>
            <span style={{ marginRight: '10px', display: 'flex', alignItems: 'center' }}>{p.icon}</span>
            {p.name}
          </div>
        ))}
      </div>

      {/* Column 2: Threads */}
      <div className={styles.threadList}>
        <div className={styles.threadListHeader}>{activePlatform} Messages</div>
        {threads.map((thread) => (
          <div key={thread.id} className={`${styles.threadItem} ${activeThread?.id === thread.id ? styles.threadItemActive : ''}`} onClick={() => handleThreadSelect(thread)}>
            <div className={styles.threadName}>{thread.title}</div>
            <div className={styles.threadTime}>{new Date(thread.timestamp).toLocaleDateString()}</div>
            <div className={styles.threadSnippet}>{thread.snippet || '(Media)'}</div>
          </div>
        ))}
        {threads.length === 0 && <div style={{ padding: 20, color: '#999' }}>No threads found</div>}
      </div>

      {/* Column 3: Chat */}
      <div className={styles.chatArea}>
        {activeThread ? (
          <>
            <div className={styles.chatHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                {activeThread.title}
                <span style={{ fontSize: '0.8rem', color: '#999', marginLeft: '10px' }}>({activeThread.file_count} pages)</span>
              </div>
              <input
                type="text"
                placeholder="Search active chat..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '16px',
                  border: '1px solid #ccc',
                  fontSize: '0.9rem',
                  outline: 'none',
                  backgroundColor: 'rgba(255,255,255,0.9)',
                  color: '#000',
                  width: '200px',
                }}
              />
            </div>
            <div className={styles.messagesContainer}>
              {filteredMessages.map((msg, i) => {
                // Determine if my message
                const isMyMsg = !!msg.is_sender;
                const prevMsg = filteredMessages[i + 1];
                const nextMsg = filteredMessages[i - 1];
                const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name;
                const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name;

                // Determine if there is a preview attached
                const urlRegex = /(https?:\/\/[^\s]+)/;
                const contentLinkMatch = msg.content ? msg.content.match(urlRegex) : null;
                const previewUrl = msg.share?.link || (contentLinkMatch ? contentLinkMatch[0] : null);

                let borderRadiusStyle = {};
                let previewBubbleStyle: React.CSSProperties = {};
                const radiusRound = '18px';
                const radiusFlat = '4px';

                const dynamicTop = isTop ? radiusRound : radiusFlat;
                const dynamicBottom = isBottom ? (previewUrl ? radiusFlat : radiusRound) : radiusFlat;

                borderRadiusStyle = {
                  borderTopLeftRadius: isMyMsg ? radiusRound : dynamicTop,
                  borderBottomLeftRadius: isMyMsg ? radiusRound : dynamicBottom,
                  borderTopRightRadius: isMyMsg ? dynamicTop : radiusRound,
                  borderBottomRightRadius: isMyMsg ? dynamicBottom : radiusRound,
                };

                if (previewUrl) {
                  const previewBottom = isBottom ? radiusRound : radiusFlat;
                  previewBubbleStyle = {
                    borderTopLeftRadius: isMyMsg ? radiusRound : radiusFlat,
                    borderBottomLeftRadius: isMyMsg ? radiusRound : previewBottom,
                    borderTopRightRadius: isMyMsg ? radiusFlat : radiusRound,
                    borderBottomRightRadius: isMyMsg ? previewBottom : radiusRound,
                  };
                }

                const showAvatar = !isMyMsg && isBottom;
                const showName = !isMyMsg && isTop;
                const isImageShare = msg.share && msg.share.link && /\.(gif|jpe?g|png|webp)($|\?)/i.test(msg.share.link);
                const hasMedia = (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0) || msg.sticker || isImageShare;
                const isMediaOnly = hasMedia && !msg.content;

                let showTimestamp = false;
                if (i === filteredMessages.length - 1) {
                  showTimestamp = true;
                } else if (filteredMessages[i + 1]) {
                  const currentDate = new Date(msg.timestamp_ms);
                  const prevDate = new Date(filteredMessages[i + 1].timestamp_ms);
                  if (
                    currentDate.getHours() !== prevDate.getHours() ||
                    currentDate.getDate() !== prevDate.getDate() ||
                    currentDate.getMonth() !== prevDate.getMonth() ||
                    currentDate.getFullYear() !== prevDate.getFullYear()
                  ) {
                    showTimestamp = true;
                  }
                }

                const timestampStr = new Date(msg.timestamp_ms).toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div id={`msg-${msg.id || msg.timestamp_ms}`} key={i}>
                    <MessageItem
                      msg={msg}
                      isMyMsg={isMyMsg}
                      isBottom={isBottom}
                      showAvatar={showAvatar}
                      showName={showName}
                      borderRadiusStyle={borderRadiusStyle}
                      isMediaOnly={!!isMediaOnly}
                      activePlatform={activePlatform}
                      showTimestamp={showTimestamp}
                      timestampStr={timestampStr}
                      previewBubbleStyle={previewBubbleStyle}
                      onQuoteClick={() => handleQuoteClick(msg.quoted_message_metadata)}
                    />
                  </div>
                );
              })}
              {(hasMore || loading) && (
                <div ref={loadMoreRef} style={{ display: 'flex', justifyContent: 'center', padding: '10px', alignItems: 'center', gap: '8px', color: '#999' }}>
                  {loading && (
                    <>
                      <FaSpinner className={styles.spinner} size={24} />
                      <span>Loading messages...</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={styles.emptyState}>Select a conversation to view</div>
        )}
      </div>
    </div>
  );
}
