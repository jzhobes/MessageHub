import React from 'react';
import { FaQuoteLeft } from 'react-icons/fa';
import styles from '../styles/index.module.css';
import LinkPreview from './LinkPreview';
import LazyView from './LazyView';
import { Message } from '../types';

export default function MessageItem({
  msg,
  isMyMsg,
  isBottom,
  showAvatar,
  showName,
  borderRadiusStyle,
  isMediaOnly,
  activePlatform,
  showTimestamp,
  timestampStr,
  previewBubbleStyle,
  onQuoteClick,
}: {
  msg: Message;
  isMyMsg: boolean;
  isBottom: boolean;
  showAvatar: boolean;
  showName: boolean;
  borderRadiusStyle: React.CSSProperties;
  isMediaOnly: boolean;
  activePlatform: string;
  showTimestamp: boolean;
  timestampStr: string;
  previewBubbleStyle?: React.CSSProperties;
  onQuoteClick?: () => void;
}) {
  const hasTextContent = !!msg.content;
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

  // Determine shared link (priority: explicit share > content link)
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const contentLinkMatch = msg.content ? msg.content.match(urlRegex) : null;
  const previewUrl = msg.share?.link || (contentLinkMatch ? contentLinkMatch[0] : null);

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
          {(hasTextContent || (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0) || msg.sticker || msg.quoted_message_metadata) && (
            <div
              className={`${styles.messageBubble} ${isMyMsg ? styles.sentBubble : styles.receivedBubble} ${isMediaOnly ? styles.mediaBubble : ''}`}
              title={formatTime(msg.timestamp_ms)}
              style={{
                ...borderRadiusStyle,
              }}
            >
              {msg.quoted_message_metadata && (
                <div
                  style={{
                    marginBottom: '8px',
                    marginLeft: '-10px',
                    marginRight: '-10px',
                    marginTop: '-5px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    borderRadius: '12px 12px 2px 2px',
                    fontSize: '0.9rem',
                    color: 'inherit',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onQuoteClick) {
                      onQuoteClick();
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, opacity: 0.8 }}>
                    <FaQuoteLeft size={10} />
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        backgroundColor: '#888',
                        color: '#fff',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {(msg.quoted_message_metadata.creator?.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>{msg.quoted_message_metadata.creator?.name || 'Unknown'}</div>
                  </div>
                  <div style={{ opacity: 0.95, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: '1.3' }}>
                    {msg.quoted_message_metadata.text}
                  </div>
                </div>
              )}
              {hasTextContent && msg.content && <div>{formatMessageContent(msg.content)}</div>}

              {/* Photos */}
              {msg.photos &&
                msg.photos.map((p, idx) => (
                  <div
                    key={`p-${idx}`}
                    style={{
                      marginTop: hasTextContent ? 5 : 0,
                    }}
                  >
                    <img
                      src={p.uri.startsWith('http') ? p.uri : `/api/media?path=${encodeURIComponent(p.uri)}&platform=${activePlatform}`}
                      alt="Photo"
                      style={{
                        maxWidth: '100%',
                        ...borderRadiusStyle,
                        maxHeight: '300px',
                        display: 'block',
                      }}
                      loading="lazy"
                    />
                  </div>
                ))}
              {/* Videos */}
              {msg.videos &&
                msg.videos.map((v, idx) => (
                  <div
                    key={`v-${idx}`}
                    style={{
                      marginTop: hasTextContent ? 5 : 0,
                    }}
                  >
                    <LazyView rootMargin="200px">
                      {(inView) => (
                        <video
                          controls
                          preload={inView ? 'metadata' : 'none'}
                          src={`/api/media?path=${encodeURIComponent(v.uri)}&platform=${activePlatform}`}
                          style={{
                            maxWidth: '100%',
                            ...borderRadiusStyle,
                            maxHeight: '300px',
                            display: 'block',
                          }}
                        />
                      )}
                    </LazyView>
                  </div>
                ))}
              {/* GIFs */}
              {msg.gifs &&
                msg.gifs.map((g, idx) => (
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
            </div>
          )}

          {/* Shared Content / Link Preview Bubble */}
          {previewUrl && (
            <div style={{ marginTop: '4px', maxWidth: '300px' }}>
              {/\.(gif|jpe?g|png|webp)($|\?)/i.test(previewUrl) ? (
                <img
                  src={previewUrl}
                  alt="Shared Image"
                  style={{
                    maxWidth: '100%',
                    borderRadius: '12px',
                    maxHeight: '300px',
                    display: 'block',
                    ...previewBubbleStyle,
                  }}
                  loading="lazy"
                />
              ) : (
                <LinkPreview url={previewUrl} style={previewBubbleStyle} />
              )}
            </div>
          )}

          {/* Reactions */}
          {msg.reactions && msg.reactions.length > 0 && (
            <div className={styles.reactionContainer} style={{ justifyContent: 'flex-end' }}>
              {msg.reactions.map((r, idx) => (
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
}
