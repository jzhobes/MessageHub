import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { FaFacebook, FaInstagram, FaPhone } from 'react-icons/fa';
import { SiGooglechat } from 'react-icons/si';
import styles from '../styles/index.module.css';

interface Thread {
  id: string; // folder name
  title: string;
  participants: string[];
  timestamp: number;
  snippet: string;
  file_count: number;
}

interface Message {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: any[];
  videos?: any[];
  gifs?: any[];
  sticker?: {
    uri: string;
  };
  share?: {
    link?: string;
    share_text?: string;
  };
  reactions?: Array<{
    reaction: string;
    actor: string;
  }>;
}

function LinkPreview({ url, initialShareText, onImageFound, hasTextContent = true }: { url: string; initialShareText?: string; onImageFound?: () => void; hasTextContent?: boolean }) {
  const [data, setData] = useState<{ image?: string; title?: string; description?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let mounted = true;
    async function fetchPreview() {
      try {
        const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const json = await res.json();
          if (mounted) {
            setData(json);
            if (json.image && onImageFound) {
              onImageFound();
            }
          }
        }
      } catch (e) {
        console.error('Preview fetch error', e);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    fetchPreview();
    return () => {
      mounted = false;
    };
  }, [url, onImageFound, isVisible]);

  if (loading) {
    return (
      <div ref={containerRef} style={{ marginTop: '8px', padding: '10px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '8px', fontSize: '0.9rem', maxWidth: '300px' }}>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#007aff', textDecoration: 'none' }}>
          {url}
        </a>
        <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '4px' }}>Loading preview...</div>
      </div>
    );
  }

  // If we have an image, render visually rich card
  if (data && data.image) {
    return (
      <div
        style={{
          marginTop: hasTextContent ? '12px' : '-10px',
          marginLeft: '-16px',
          marginRight: '-16px',
          marginBottom: '-10px',
          width: 'calc(100% + 32px)',
          maxWidth: '300px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Preview Image */}
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%' }}>
          <img
            src={data.image}
            alt="Preview"
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              // If we have dimensions, we could use aspect-ratio, but strict max-height + cover is bad for vertical images.
              // Let's remove max-height to let it fit naturally, or ensure it's contained if we force a height.
              // For now, removing constraints to let image define its size usually looks best in modern chats.
            }}
          />
        </a>
        {/* Text Content */}
        <div style={{ padding: '10px 12px', backgroundColor: '#f0f0f5', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#000' }}>{data.title || url}</div>
        </div>
      </div>
    );
  }

  // Fallback if no preview fetch success
  return null;
}

const MessageItem = ({
  msg,
  isMyMsg,
  isBottom,
  isTop,
  showAvatar,
  showName,
  borderRadiusStyle,
  isMediaOnly,
  activePlatform,
  showTimestamp,
  timestampStr,
}: {
  msg: Message;
  isMyMsg: boolean;
  isBottom: boolean;
  isTop: boolean;
  showAvatar: boolean;
  showName: boolean;
  borderRadiusStyle: React.CSSProperties;
  isMediaOnly: boolean;
  activePlatform: string;
  showTimestamp: boolean;
  timestampStr: string;
}) => {
  const [hasPreviewImage, setHasPreviewImage] = useState(false);

  // Helper to format text with links
  const formatMessageContent = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const formatTime = (ms: number) => {
    return new Date(ms).toLocaleString();
  };

  // Calculate if we're showing text content
  const hasTextContent = !!(msg.content && (!msg.share || !/sent an attachment\.?$/i.test(msg.content)));

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Timestamp (Rendered BEFORE row, so displays ABOVE considering column layout) */}
      {showTimestamp && <div className={styles.timestampLabel}>{timestampStr}</div>}

      <div className={`${styles.messageRow} ${isMyMsg ? styles.sentRow : styles.receivedRow} ${isBottom ? styles.messageRowGroupEnd : ''}`}>
        {/* Avatar Area (Left) */}
        {!isMyMsg && (
          <div className={`${styles.avatarArea} ${msg.reactions && msg.reactions.length > 0 ? styles.hasReactionsAvatar : ''}`}>
            {showAvatar && (
              <div className={styles.profileImage} title={msg.sender_name}>
                {msg.sender_name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        )}

        <div
          className={`${styles.messageContentStack} ${msg.reactions && msg.reactions.length > 0 ? styles.hasReactions : ''}`}
          style={{
            alignItems: isMyMsg ? 'flex-end' : 'flex-start',
          }}
        >
          {/* Name (Outside, Above) */}
          {showName && <div className={styles.senderNameOutside}>{msg.sender_name}</div>}

          {/* Bubble */}
          <div
            className={`${styles.messageBubble} ${isMyMsg ? styles.sentBubble : styles.receivedBubble} ${isMediaOnly ? styles.mediaBubble : ''}`}
            title={formatTime(msg.timestamp_ms)}
            style={{
              ...borderRadiusStyle,
              maxWidth: msg.share?.link ? '300px' : undefined,
            }}
          >
            {hasTextContent && msg.content && <div>{formatMessageContent(msg.content)}</div>}

            {/* Photos */}
            {msg.photos &&
              msg.photos.map((p: any, idx: number) => (
                <div
                  key={`p-${idx}`}
                  style={{
                    marginTop: hasTextContent ? 5 : 0,
                  }}
                >
                  <img
                    src={`/api/media?path=${encodeURIComponent(p.uri)}&platform=${activePlatform}`}
                    alt="Photo"
                    style={{
                      maxWidth: '100%',
                      borderRadius: '12px',
                      maxHeight: '300px',
                      display: 'block',
                    }}
                    loading="lazy"
                  />
                </div>
              ))}
            {/* Videos */}
            {msg.videos &&
              msg.videos.map((v: any, idx: number) => (
                <div
                  key={`v-${idx}`}
                  style={{
                    marginTop: hasTextContent ? 5 : 0,
                  }}
                >
                  <video
                    src={`/api/media?path=${encodeURIComponent(v.uri)}&platform=${activePlatform}`}
                    controls
                    preload="none"
                    style={{
                      maxWidth: '100%',
                      borderRadius: '12px',
                      maxHeight: '300px',
                      display: 'block',
                    }}
                  />
                </div>
              ))}
            {/* GIFs */}
            {msg.gifs &&
              msg.gifs.map((g: any, idx: number) => (
                <div
                  key={`g-${idx}`}
                  style={{
                    marginTop: hasTextContent ? 5 : 0,
                  }}
                >
                  <img
                    src={`/api/media?path=${encodeURIComponent(g.uri)}&platform=${activePlatform}`}
                    alt="GIF"
                    style={{
                      maxWidth: '100%',
                      borderRadius: '12px',
                      maxHeight: '300px',
                      display: 'block',
                    }}
                    loading="lazy"
                  />
                </div>
              ))}

            {/* Stickers */}
            {msg.sticker && (
              <div
                style={{
                  marginTop: hasTextContent ? 5 : 0,
                }}
              >
                <img
                  src={`/api/media?path=${encodeURIComponent(msg.sticker.uri)}&platform=${activePlatform}`}
                  alt="Sticker"
                  style={{
                    maxWidth: '120px',
                    borderRadius: '0',
                    display: 'block',
                  }}
                  loading="lazy"
                />
              </div>
            )}

            {/* Shared Content */}
            {msg.share && msg.share.link && (
              <>
                {/\.(gif|jpe?g|png|webp)($|\?)/i.test(msg.share.link) ? (
                  <div style={{ marginTop: '5px' }}>
                    <img
                      src={msg.share.link}
                      alt="Shared Image"
                      style={{
                        maxWidth: '100%',
                        borderRadius: '12px',
                        maxHeight: '300px',
                        display: 'block',
                      }}
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <LinkPreview url={msg.share.link} initialShareText={msg.share.share_text} onImageFound={() => setHasPreviewImage(true)} hasTextContent={hasTextContent} />
                )}
              </>
            )}
          </div>

          {/* Reactions */}
          {msg.reactions && msg.reactions.length > 0 && (
            <div className={styles.reactionContainer} style={{ justifyContent: 'flex-end' }}>
              {msg.reactions.map((r: any, idx: number) => (
                <div key={idx} className={styles.reactionBubble} title={r.actor}>
                  {r.reaction}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function Home() {
  const router = useRouter();

  const [activePlatform, setActivePlatform] = useState('Facebook');
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
    if (!isRouterReady) return;

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
    const query: any = { platform };
    if (threadId) query.threadId = threadId;

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
    if (!isRouterReady) return;

    async function loadThreads() {
      try {
        const res = await fetch(`/api/threads?platform=${encodeURIComponent(activePlatform)}`);
        if (res.ok) {
          const data = await res.json();
          setThreads(data);
        }
      } catch (e) {
        console.error('Failed to load threads', e);
      }
    }
    loadThreads();
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
    updateUrl(activePlatform, t.id);
  };

  // Load Messages for Thread
  useEffect(() => {
    if (!activeThread) {
      return;
    }

    setMessages([]);
    setPage(1);
    loadMessages(activeThread.id, 1, true); // Reset
  }, [activeThread]);

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

  const handleLoadMore = () => {
    if (!activeThread) {
      return;
    }
    const nextPage = page + 1;
    setPage(nextPage);
    loadMessages(activeThread.id, nextPage, false);
  };

  const isMe = (name: string) => name === 'John Ho' || name === 'Virtual Me';

  const filteredMessages = messages.filter((msg) => {
    if (!msg.content) {
      return true;
    }
    if (/reacted\s+.+?\s+to your message/i.test(msg.content)) {
      return false;
    }
    return true;
  });

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
            <div className={styles.chatHeader}>
              {activeThread.title}
              <span style={{ fontSize: '0.8rem', color: '#999', marginLeft: '10px' }}>({activeThread.file_count} pages)</span>
            </div>
            <div className={styles.messagesContainer}>
              {loading && messages.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Loading messages...</div>}
              {filteredMessages.map((msg, i) => {
                const isMyMsg = isMe(msg.sender_name);
                const prevMsg = filteredMessages[i + 1];
                const nextMsg = filteredMessages[i - 1];
                const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name;
                const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name;

                let borderRadiusStyle = {};
                const R = '18px';
                const F = '4px';

                if (isMyMsg) {
                  borderRadiusStyle = {
                    borderTopRightRadius: isTop ? R : F,
                    borderBottomRightRadius: isBottom ? R : F,
                    borderTopLeftRadius: R,
                    borderBottomLeftRadius: R,
                  };
                } else {
                  borderRadiusStyle = {
                    borderTopLeftRadius: isTop ? R : F,
                    borderBottomLeftRadius: isBottom ? R : F,
                    borderTopRightRadius: R,
                    borderBottomRightRadius: R,
                  };
                }

                const showAvatar = !isMyMsg && isBottom;
                const showName = !isMyMsg && isTop;
                const isImageShare = msg.share && msg.share.link && /\.(gif|jpe?g|png|webp)($|\?)/i.test(msg.share.link);
                const hasMedia = (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0) || msg.sticker || isImageShare;
                const isMediaOnly = hasMedia && !msg.content;

                let showTimestamp = false;
                if (i === messages.length - 1) {
                  showTimestamp = true;
                } else if (messages[i + 1]) {
                  const currentDate = new Date(msg.timestamp_ms);
                  const prevDate = new Date(messages[i + 1].timestamp_ms);
                  if (currentDate.getHours() !== prevDate.getHours() || currentDate.getDate() !== prevDate.getDate() || currentDate.getMonth() !== prevDate.getMonth()) {
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
                  <MessageItem
                    key={i}
                    msg={msg}
                    isMyMsg={isMyMsg}
                    isBottom={isBottom}
                    isTop={isTop}
                    showAvatar={showAvatar}
                    showName={showName}
                    borderRadiusStyle={borderRadiusStyle}
                    isMediaOnly={!!isMediaOnly}
                    activePlatform={activePlatform}
                    showTimestamp={showTimestamp}
                    timestampStr={timestampStr}
                  />
                );
              })}

              {hasMore && (
                <div className={styles.loadMore} onClick={handleLoadMore}>
                  {loading ? 'Loading...' : 'Load Older Messages'}
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
