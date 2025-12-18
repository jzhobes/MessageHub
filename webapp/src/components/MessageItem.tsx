import React from 'react';
import {
  FaQuoteLeft,
  FaFileDownload,
  FaFilePdf,
  FaFileWord,
  FaFileExcel,
  FaFileCsv,
  FaFileArchive,
} from 'react-icons/fa';

import { Message } from '@/lib/shared/types';

import LazyView from './LazyView';
import LinkPreview from './LinkPreview';
import styles from './MessageItem.module.css';

const FILE_ICON_MAP: Record<string, React.ElementType> = {
  pdf: FaFilePdf,
  doc: FaFileWord,
  docx: FaFileWord,
  xls: FaFileExcel,
  xlsx: FaFileExcel,
  csv: FaFileCsv,
  zip: FaFileArchive,
  rar: FaFileArchive,
  '7z': FaFileArchive,
  tar: FaFileArchive,
  gz: FaFileArchive,
};

export default function MessageItem({
  msg,
  isMyMsg,
  isTarget,
  highlightToken,
  showAvatar,
  showName,
  activePlatform,
  onQuoteClick,
}: {
  msg: Message;
  isMyMsg: boolean;
  isTarget?: boolean;
  highlightToken?: number;
  showAvatar: boolean;
  showName: boolean;
  activePlatform: string;
  onQuoteClick?: () => void;
}) {
  const hasTextContent = !!msg.content;
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isTarget && bubbleRef.current && highlightToken) {
      const animation = bubbleRef.current.animate(
        [
          { transform: 'scale(1)', boxShadow: '0 0 0 0 var(--highlight-border)' },
          { transform: 'scale(1.1)', boxShadow: '0 0 0 5px rgba(0, 122, 255, 0)' },
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0, 122, 255, 0)' },
        ],
        { duration: 1000, easing: 'ease-in-out' },
      );
      return () => animation.cancel();
    }
  }, [isTarget, highlightToken]);

  const formatMessageContent = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.messageLink}
            onClick={(e) => e.stopPropagation()}
          >
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

  const isImageShare = msg.share && msg.share.link && /\.(gif|jpe?g|png|webp)($|\?)/i.test(msg.share.link);
  const hasMedia =
    (msg.photos && msg.photos.length > 0) ||
    (msg.videos && msg.videos.length > 0) ||
    (msg.gifs && msg.gifs.length > 0) ||
    msg.sticker ||
    isImageShare;
  const isMediaOnly = hasMedia && !msg.content;

  // Filter photos if we are showing a link preview (avoids duplicates)
  const displayPhotos = previewUrl && msg.photos ? [] : msg.photos || [];

  // Construct Class Names for Bubble
  const bubbleClasses = [
    styles.messageBubble,
    isMyMsg ? styles.sentBubble : styles.receivedBubble,
    isMediaOnly ? styles.mediaBubble : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Add a plain class for global targeting by ChatWindow
  const bubbleClassName = `${bubbleClasses} messageBubble`;

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className={`${styles.messageRow} ${isMyMsg ? styles.justifyRight : styles.justifyLeft}`}>
        {/* Avatar (left) */}
        {!isMyMsg && (
          <div
            className={`${styles.avatarArea} ${msg.reactions && msg.reactions.length > 0 ? styles.hasReactionsAvatar : ''}`}
          >
            {showAvatar && (
              <div className={styles.profileImage} title={msg.sender_name}>
                {msg.sender_name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        )}

        <div
          className={`${styles.messageContentStack} ${isMyMsg ? styles.alignRight : styles.alignLeft} ${msg.reactions && msg.reactions.length > 0 ? styles.hasReactions : ''}`}
        >
          {/* Name (outside, above) */}
          {showName && <div className={`${styles.senderNameOutside} showName`}>{msg.sender_name}</div>}

          {/* Bubble */}
          {(hasTextContent ||
            displayPhotos?.length ||
            msg.videos?.length ||
            msg.gifs?.length ||
            msg.attachments?.length ||
            msg.sticker ||
            msg.quoted_message_metadata) && (
            <div ref={bubbleRef} className={bubbleClassName} title={formatTime(msg.timestamp_ms)}>
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
                    <div className={styles.quoteAvatar}>
                      {(msg.quoted_message_metadata.creator?.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>{msg.quoted_message_metadata.creator?.name || 'Unknown'}</div>
                  </div>
                  <div className={styles.quoteText}>{msg.quoted_message_metadata.text}</div>
                </div>
              )}
              {hasTextContent && msg.content && <div>{formatMessageContent(msg.content)}</div>}
              {/* photos */}
              {displayPhotos.length > 0 &&
                displayPhotos.map(({ uri }, idx) => (
                  <div key={`p-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                    <img
                      src={
                        uri.startsWith('http')
                          ? uri
                          : `/api/media?path=${encodeURIComponent(uri)}&platform=${activePlatform}`
                      }
                      alt="Photo"
                      className={styles.msgImage}
                      loading="lazy"
                    />
                  </div>
                ))}
              {/* videos */}
              {msg.videos?.map(({ uri }, idx) => (
                <div key={`v-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                  <LazyView rootMargin="200px">
                    {(inView) => (
                      <video
                        controls
                        preload={inView ? 'metadata' : 'none'}
                        src={`/api/media?path=${encodeURIComponent(uri)}&platform=${activePlatform}`}
                        className={styles.msgVideo}
                      />
                    )}
                  </LazyView>
                </div>
              ))}
              {/* gifs */}
              {msg.gifs?.map(({ uri }, idx) => (
                <div key={`g-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                  <img
                    src={`/api/media?path=${encodeURIComponent(uri)}&platform=${activePlatform}`}
                    alt="GIF"
                    className={styles.msgGif}
                    loading="lazy"
                  />
                </div>
              ))}
              {/* attachments */}
              {msg.attachments?.map(({ uri }, idx) => {
                const fileName = (uri.split('/').pop() || 'File').replace(/^File-/, '');
                const fileUrl = `/api/media?path=${encodeURIComponent(uri)}&platform=${activePlatform}`;
                const ext = fileName.split('.').pop()?.toLowerCase();
                const Icon = (ext && FILE_ICON_MAP[ext]) || FaFileDownload;

                return (
                  <div key={`a-${idx}`} className={hasTextContent ? styles.mediaMargin : ''}>
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.attachmentCard}
                      title="Download File"
                    >
                      <Icon size={20} />
                      <span style={{ fontSize: '0.9em', wordBreak: 'break-all' }}>{fileName}</span>
                    </a>
                  </div>
                );
              })}
              {/* stickers */}
              {msg.sticker && (
                <div className={hasTextContent ? styles.mediaMargin : ''}>
                  <img
                    src={`/api/media?path=${encodeURIComponent(msg.sticker.uri)}&platform=${activePlatform}`}
                    alt="Sticker"
                    className={styles.msgSticker}
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          )}
          {/* shared content / link preview bubble */}
          {previewUrl && <LinkPreview url={previewUrl} />}
          {/* reactions */}
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
