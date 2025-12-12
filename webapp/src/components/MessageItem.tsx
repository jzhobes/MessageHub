import React from 'react';
import { FaQuoteLeft } from 'react-icons/fa';
import styles from '../styles/index.module.css';
import LinkPreview from './LinkPreview';
import LazyView from './LazyView';
import { Message } from '../types';

export default function MessageItem({
  msg,
  isMyMsg,
  isFirst,
  isLast,
  showAvatar,
  showName,
  isMediaOnly,
  hasPreview,
  activePlatform,
  showTimestamp,
  timestampStr,
  onQuoteClick,
}: {
  msg: Message;
  isMyMsg: boolean;
  isFirst: boolean;
  isLast: boolean;
  showAvatar: boolean;
  showName: boolean;
  isMediaOnly: boolean;
  hasPreview: boolean;
  activePlatform: string;
  showTimestamp: boolean;
  timestampStr: string;
  onQuoteClick?: () => void;
}) {
  const hasTextContent = !!msg.content;

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

  const urlRegex = /(https?:\/\/[^\s]+)/;
  const contentLinkMatch = msg.content ? msg.content.match(urlRegex) : null;
  const previewUrl = msg.share?.link || (contentLinkMatch ? contentLinkMatch[0] : null);

  // Construct Class Names for Bubble
  const bubbleClasses = [
    styles.messageBubble,
    isMyMsg ? styles.sentBubble : styles.receivedBubble,
    isFirst ? styles.first : '',
    isLast ? styles.last : '',
    hasPreview ? styles.hasPreview : '',
    isMediaOnly ? styles.mediaBubble : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Timestamp */}
      {showTimestamp && <div className={styles.timestampLabel}>{timestampStr}</div>}

      <div className={`${styles.messageRow} ${isMyMsg ? styles.sentRow : styles.receivedRow} ${isLast ? styles.messageRowGroupEnd : ''}`}>
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

        <div className={`${styles.messageContentStack} ${isMyMsg ? styles.alignRight : styles.alignLeft} ${msg.reactions && msg.reactions.length > 0 ? styles.hasReactions : ''}`}>
          {/* Name (Outside, Above) */}
          {showName && <div className={styles.senderNameOutside}>{msg.sender_name}</div>}

          {/* Bubble */}
          {(hasTextContent || (msg.photos && msg.photos.length > 0) || (msg.videos && msg.videos.length > 0) || (msg.gifs && msg.gifs.length > 0) || msg.sticker || msg.quoted_message_metadata) && (
            <div className={bubbleClasses} title={formatTime(msg.timestamp_ms)}>
              {msg.quoted_message_metadata && (
                <div
                  className={styles.quoteContainer}
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuoteClick?.();
                  }}
                >
                  <div className={styles.quoteHeader}>
                    <FaQuoteLeft size={10} />
                    <div className={styles.quoteAvatar}>{(msg.quoted_message_metadata.creator?.name || '?').charAt(0).toUpperCase()}</div>
                    <div>{msg.quoted_message_metadata.creator?.name || 'Unknown'}</div>
                  </div>
                  <div className={styles.quoteText}>{msg.quoted_message_metadata.text}</div>
                </div>
              )}
              {hasTextContent && msg.content && <div>{formatMessageContent(msg.content)}</div>}

              {/* Photos */}
              {msg.photos &&
                msg.photos.map((p, idx) => (
                  <div key={`p-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                    <img src={p.uri.startsWith('http') ? p.uri : `/api/media?path=${encodeURIComponent(p.uri)}&platform=${activePlatform}`} alt="Photo" className={styles.msgImage} loading="lazy" />
                  </div>
                ))}
              {/* Videos */}
              {msg.videos &&
                msg.videos.map((v, idx) => (
                  <div key={`v-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                    <LazyView rootMargin="200px">
                      {(inView) => (
                        <video controls preload={inView ? 'metadata' : 'none'} src={`/api/media?path=${encodeURIComponent(v.uri)}&platform=${activePlatform}`} className={styles.msgVideo} />
                      )}
                    </LazyView>
                  </div>
                ))}
              {/* GIFs */}
              {msg.gifs &&
                msg.gifs.map((g, idx) => (
                  <div key={`g-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                    <img src={`/api/media?path=${encodeURIComponent(g.uri)}&platform=${activePlatform}`} alt="GIF" className={styles.msgGif} loading="lazy" />
                  </div>
                ))}

              {/* Stickers */}
              {msg.sticker && (
                <div className={hasTextContent ? styles.mediaMargin : ''}>
                  <img src={`/api/media?path=${encodeURIComponent(msg.sticker.uri)}&platform=${activePlatform}`} alt="Sticker" className={styles.msgSticker} loading="lazy" />
                </div>
              )}
            </div>
          )}

          {/* Shared Content / Link Preview Bubble */}
          {previewUrl && (
            <div className={styles.previewContainer}>
              {/\.(gif|jpe?g|png|webp)($|\?)/i.test(previewUrl) ? (
                <img src={previewUrl} alt="Shared Image" className={`${styles.previewImage} ${isMyMsg ? styles.previewBubbleSent : styles.previewBubbleReceived}`} loading="lazy" />
              ) : (
                <LinkPreview url={previewUrl} isMyMsg={isMyMsg} />
              )}
            </div>
          )}

          {/* Reactions */}
          {msg.reactions && msg.reactions.length > 0 && (
            <div className={styles.reactionContainer}>
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
