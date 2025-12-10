
'use client';

import { useState, useEffect } from 'react';
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
}

export default function Home() {
    const [activePlatform, setActivePlatform] = useState('FB');
    const [threads, setThreads] = useState<Thread[]>([]);
    const [activeThread, setActiveThread] = useState<Thread | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);

    // Load Threads
    useEffect(() => {
        async function loadThreads() {
            if (activePlatform !== 'FB') {
                setThreads([]);
                return;
            }
            try {
                const res = await fetch('/api/threads?platform=FB');
                if (res.ok) {
                    const data = await res.json();
                    setThreads(data);
                }
            } catch (e) {
                console.error("Failed to load threads", e);
            }
        }
        loadThreads();
    }, [activePlatform]);

    // Load Messages for Thread
    useEffect(() => {
        if (!activeThread) return;

        setMessages([]);
        setPage(1);
        loadMessages(activeThread.id, 1, true); // Reset
    }, [activeThread]);

    const loadMessages = async (threadId: string, pageNum: number, reset: boolean) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/messages?threadId=${threadId}&page=${pageNum}`);
            if (res.ok) {
                const data = await res.json();
                // data.messages is expected
                const newMsgs = data.messages || [];

                if (reset) {
                    setMessages(newMsgs);
                } else {
                    setMessages(prev => [...prev, ...newMsgs]);
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
        if (!activeThread) return;
        const nextPage = page + 1;
        setPage(nextPage);
        loadMessages(activeThread.id, nextPage, false);
    };

    const formatTime = (ms: number) => {
        return new Date(ms).toLocaleString();
    };

    // Identify "Me"
    const isMe = (name: string) => name === 'John Ho' || name === 'Virtual Me';

    return (
        <div className={styles.container}>
            {/* Column 1: Platforms */}
            <div className={styles.sidebar}>
                <div className={styles.sidebarTitle}>Virtual Me</div>
                {['FB', 'Instagram', 'Google Chat', 'Google Voice'].map(p => (
                    <div
                        key={p}
                        className={`${styles.navItem} ${activePlatform === p ? styles.navItemActive : ''}`}
                        onClick={() => setActivePlatform(p)}
                    >
                        {p}
                    </div>
                ))}
            </div>

            {/* Column 2: Threads */}
            <div className={styles.threadList}>
                <div className={styles.threadListHeader}>
                    {activePlatform} Messages
                </div>
                {threads.map(thread => (
                    <div
                        key={thread.id}
                        className={`${styles.threadItem} ${activeThread?.id === thread.id ? styles.threadItemActive : ''}`}
                        onClick={() => setActiveThread(thread)}
                    >
                        <div className={styles.threadName}>{thread.title}</div>
                        <div className={styles.threadTime}>
                            {new Date(thread.timestamp).toLocaleDateString()}
                        </div>
                        <div className={styles.threadSnippet}>
                            {thread.snippet || '(Media)'}
                        </div>
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
                            <span style={{ fontSize: '0.8rem', color: '#999', marginLeft: '10px' }}>
                                ({activeThread.file_count} pages)
                            </span>
                        </div>
                        <div className={styles.messagesContainer}>
                            {/* 
                 Note: The container uses flex-direction: column-reverse. 
                 So the FIRST item in the array (messages[0]) is rendered at the BOTTOM.
                 To determine grouping visually (top-to-bottom), we need to look at neighbours.
                 
                 Visually: 
                   Msg A (Oldest)
                   Msg B (Older)
                   Msg C (Newest)
                 
                 In Array (Reverse chronological usually from API logic? Wait, our API logic is:
                 fb json: messages[0] is newest. 
                 Our loadMessages sets: newMsgs. 
                 If paging, we append.
                 
                 Let's assume messages[0] is the NEWEST message (Bottom of chat).
                 messages[1] is older.
                 
                 "Bottom-left of their message" means the last message in a block *chronologically*.
                 Since we render column-reverse:
                 The item visually at the bottom of a block is the one with the smallest index in that block.
                 
                 Example Block:
                 [Index 3] Sender A
                 [Index 2] Sender A
                 [Index 1] Sender A  <- This one gets the avatar (Visually last)
                 [Index 0] Sender B
               */}

                            {messages.map((msg, i) => {
                                const isMyMsg = isMe(msg.sender_name);

                                // GROUPING LOGIC
                                // Messages are rendered in reverse (index 0 is bottom).
                                // Visually:
                                // [Top, Index k]    -> First in Group (Top corners rounded, Bottom flat?)
                                // [Mid, Index k-1]  -> Middle (Flat)
                                // [Bot, Index 0]    -> Last in Group (Top flat, Bottom rounded)

                                // We need to look at i+1 (Above) and i-1 (Below).
                                const prevMsg = messages[i + 1]; // Visually Above
                                const nextMsg = messages[i - 1]; // Visually Below

                                const isTop = !prevMsg || prevMsg.sender_name !== msg.sender_name;
                                const isBottom = !nextMsg || nextMsg.sender_name !== msg.sender_name;

                                // Determine Border Radius Class
                                // default radius is 18px.
                                // We want to Flatten corners on the "consecutive" side.
                                // Left side (Other): Flatten Left corners.
                                // Right side (Me): Flatten Right corners.

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
                                        borderBottomLeftRadius: R
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
                                        borderBottomRightRadius: R
                                    };
                                }

                                // Also need to handle margin. 
                                // If not isBottom (i.e. there is a message below us same sender), margin-bottom should be small (2px).
                                // If isBottom, margin-bottom larger (12px) -> moved to wrapper logic

                                // Avatar Logic (Bottom of group)
                                const showAvatar = !isMyMsg && isBottom;

                                // Name Logic (Top of group)
                                const showName = !isMyMsg && isTop;

                                const hasMedia = (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0);
                                const isMediaOnly = hasMedia && !msg.content;

                                return (
                                    <div
                                        key={i}
                                        className={`${styles.messageRow} ${isMyMsg ? styles.sentRow : styles.receivedRow} ${isBottom ? styles.messageRowGroupEnd : ''}`}
                                    >
                                        {/* Avatar Area (Left) */}
                                        {!isMyMsg && (
                                            <div className={styles.avatarArea}>
                                                {showAvatar && (
                                                    <div className={styles.profileImage} title={msg.sender_name}>
                                                        {msg.sender_name.charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className={styles.messageContentStack} style={{ alignItems: isMyMsg ? 'flex-end' : 'flex-start' }}>
                                            {/* Name (Outside, Above) */}
                                            {showName && <div className={styles.senderNameOutside}>{msg.sender_name}</div>}

                                            {/* Bubble */}
                                            <div
                                                className={`${styles.messageBubble} ${isMyMsg ? styles.sentBubble : styles.receivedBubble} ${isMediaOnly ? styles.mediaBubble : ''}`}
                                                title={formatTime(msg.timestamp_ms)}
                                                style={borderRadiusStyle}
                                            >
                                                {msg.content && <div>{msg.content}</div>}

                                                {/* Photos */}
                                                {msg.photos && msg.photos.map((p: any, idx: number) => (
                                                    <div key={`p-${idx}`} style={{ marginTop: msg.content ? 5 : 0 }}>
                                                        <img
                                                            src={`/api/media?path=${encodeURIComponent(p.uri)}`}
                                                            alt="Photo"
                                                            style={{ maxWidth: '100%', borderRadius: '12px', maxHeight: '300px', display: 'block' }}
                                                            loading="lazy"
                                                        />
                                                    </div>
                                                ))}
                                                {/* Videos */}
                                                {msg.videos && msg.videos.map((v: any, idx: number) => (
                                                    <div key={`v-${idx}`} style={{ marginTop: msg.content ? 5 : 0 }}>
                                                        <video
                                                            src={`/api/media?path=${encodeURIComponent(v.uri)}`}
                                                            controls
                                                            style={{ maxWidth: '100%', borderRadius: '12px', maxHeight: '300px', display: 'block' }}
                                                        />
                                                    </div>
                                                ))}
                                                {/* GIFs */}
                                                {msg.gifs && msg.gifs.map((g: any, idx: number) => (
                                                    <div key={`g-${idx}`} style={{ marginTop: msg.content ? 5 : 0 }}>
                                                        <img
                                                            src={`/api/media?path=${encodeURIComponent(g.uri)}`}
                                                            alt="GIF"
                                                            style={{ maxWidth: '100%', borderRadius: '12px', maxHeight: '300px', display: 'block' }}
                                                            loading="lazy"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
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
                    <div className={styles.emptyState}>
                        Select a conversation to view
                    </div>
                )}
            </div>
        </div>
    );
}
