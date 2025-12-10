'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { FaFacebook, FaInstagram, FaPhone } from 'react-icons/fa';
import { SiGooglechat } from 'react-icons/si';
import styles from './page.module.css';

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

// Link Preview Component
function LinkPreview({ url, initialShareText, onImageFound, hasTextContent = true }: { url: string; initialShareText?: string; onImageFound?: () => void; hasTextContent?: boolean }) {
  const [data, setData] = useState<{ image?: string; title?: string; description?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [url, onImageFound]);

  if (loading) {
    return (
      <div style={{ marginTop: '8px', padding: '10px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '8px', fontSize: '0.9rem' }}>
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
          maxWidth: '332px',
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
          {/* {data.description && (
            <div style={{ fontSize: '0.8rem', color: '#666', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.3' }}>{data.description}</div>
          )} */}
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
              maxWidth: hasPreviewImage ? '300px' : undefined,
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

// Internal component that uses search params
function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [activePlatform, setActivePlatform] = useState(searchParams.get('platform') || 'Facebook');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Sync state with URL params on mount/update
  useEffect(() => {
    const platformParam = searchParams.get('platform');
    const threadIdParam = searchParams.get('threadId');

    // 1. Handle Platform Change
    if (platformParam && platformParam !== activePlatform) {
      setActivePlatform(platformParam);
      return; // Platform change triggers its own effect
    }

    // 2. Handle Thread Change (Same Platform)
    // Ensure we have threads loaded before trying to set active thread
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
  }, [searchParams, activePlatform, activeThread, threads]);

  // Derived: update URL helper
  const updateUrl = (platform: string, threadId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('platform', platform);
    if (threadId) {
      params.set('threadId', threadId);
    } else {
      params.delete('threadId');
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Load Threads & Handle initial thread selection
  useEffect(() => {
    async function loadThreads() {
      if (activePlatform !== 'Facebook' && activePlatform !== 'Instagram') {
        setThreads([]);
        return;
      }
      try {
        const res = await fetch(`/api/threads?platform=${activePlatform}`);
        if (res.ok) {
          const data = await res.json();
          setThreads(data);
          // Active thread is handled by the searchParams effect now
        }
      } catch (e) {
        console.error('Failed to load threads', e);
      }
    }
    loadThreads();
  }, [activePlatform]);

  // Handlers now ONLY update URL. State sync happens in useEffect.
  const handlePlatformSelect = (p: string) => {
    updateUrl(p, undefined);
  };

  const handleThreadSelect = (t: Thread) => {
    // Optimistic update check? No, let's keep it strictly 'URL fetches state' to avoid race.
    // But to make it feel responsive, could we clear messages?
    // setMessages([]); // Optional: prevent seeing old messages while switching?
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
      const res = await fetch(`/api/messages?threadId=${threadId}&page=${pageNum}&platform=${activePlatform}`);
      if (res.ok) {
        const data = await res.json();
        // data.messages is expected
        const newMsgs = data.messages || [];

        if (reset) {
          setMessages(newMsgs);
        } else {
          setMessages((prev) => [...prev, ...newMsgs]);
        }

        // Check if we have more pages (naive check or rely on file_count)
        // message_1.json exists. If current result < expected limit?
        // Or just allow user to click "Load Older" until 404.
        setHasMore(newMsgs.length > 0 && true /* We could accept header or try next page */);
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

  // Identify "Me"
  const isMe = (name: string) => name === 'John Ho' || name === 'Virtual Me';

  const filteredMessages = messages.filter((msg) => {
    if (!msg.content) {
      return true;
    }

    // Check for "Reacted [emoji] to your message" pattern (or "User reacted...")
    // Filter out ALL reaction notifications
    // Updated regex to be more permissive: contains "reacted", any emoji/text, then "to your message"
    if (/reacted\s+.+?\s+to your message/i.test(msg.content)) {
      return false;
    }
    return true;
  });

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
              {/*
                 Note: The container uses flex-direction: column-reverse.
                 So the FIRST item in the array (messages[0]) is rendered at the BOTTOM.

                 "Bottom-left of their message" means the last message in a block *chronologically*.
                 Since we render column-reverse:
                 The item visually at the bottom of a block is the one with the smallest index in that block.

                 Example Block:
                 [Index 3] Sender A
                 [Index 2] Sender A
                 [Index 1] Sender A  <- This one gets the avatar (Visually last)
                 [Index 0] Sender B
               */}

              {filteredMessages.map((msg, i) => {
                const isMyMsg = isMe(msg.sender_name);

                // Check neighbours for grouping
                const prevMsg = filteredMessages[i + 1]; // Visually Above
                const nextMsg = filteredMessages[i - 1]; // Visually Below

                const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name;
                const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name;

                // Determine Border Radius Class
                let borderRadiusStyle = {};
                const R = '18px';
                const F = '4px'; // Flattened radius (not 0, usually small curve looks better, or 2px)

                if (isMyMsg) {
                  // Right Side
                  // Top-Right corner: Rounded if isTop, Flat if not
                  // Bottom-Right corner: Rounded if isBottom, Flat if not
                  // Left corners always rounded (18px)
                  borderRadiusStyle = {
                    borderTopRightRadius: isTop ? R : F,
                    borderBottomRightRadius: isBottom ? R : F,
                    borderTopLeftRadius: R,
                    borderBottomLeftRadius: R,
                  };
                } else {
                  // Left Side
                  // Top-Left: Rounded if isTop
                  // Bottom-Left: Rounded if isBottom
                  // Right corners always rounded
                  borderRadiusStyle = {
                    borderTopLeftRadius: isTop ? R : F,
                    borderBottomLeftRadius: isBottom ? R : F,
                    borderTopRightRadius: R,
                    borderBottomRightRadius: R,
                  };
                }

                // Also need to handle margin.
                // If not isBottom (i.e. there is a message below us same sender), margin-bottom should be small (2px).
                // If isBottom, margin-bottom larger (12px) -> moved to wrapper logic

                // Avatar Logic (Bottom of group)
                const showAvatar = !isMyMsg && isBottom;

                // Name Logic (Top of group)
                const showName = !isMyMsg && isTop;

                const isImageShare = msg.share && msg.share.link && /\.(gif|jpe?g|png|webp)($|\?)/i.test(msg.share.link);
                const hasMedia = (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0) || msg.sticker || isImageShare;
                const isMediaOnly = hasMedia && !msg.content;

                // Timestamp Logic
                // Show if it's the start of the list (i === messages.length - 1)
                // OR if the hour differs from the previous message (msg[i+1])
                let showTimestamp = false;
                if (i === messages.length - 1) {
                  showTimestamp = true;
                } else if (messages[i + 1]) {
                  const currentDate = new Date(msg.timestamp_ms);
                  const prevDate = new Date(messages[i + 1].timestamp_ms);
                  // Compare hours (and different days completely)
                  // Simple check: if different hour OR different date
                  // checking absolute hour difference
                  // To be safe: check formatting string equality? Or getHours()
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

export default function Home() {
  return (
    <Suspense fallback={<div>Loading Virtual Me...</div>}>
      <ChatContent />
    </Suspense>
  );
}
