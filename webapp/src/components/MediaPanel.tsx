import React, { useEffect, useMemo, useState } from 'react';

import { FaImage, FaPlay, FaSpinner, FaTimes } from 'react-icons/fa';
import { VirtuosoGrid } from 'react-virtuoso';

import styles from './MediaPanel.module.css';

interface MediaItem {
  messageId: number;
  threadId: string;
  timestamp: number;
  mediaUrl: string;
  mediaType: 'photo' | 'video' | 'gif' | 'sticker';
  thumbnailUrl?: string;
}

interface MediaPanelProps {
  threadId: string;
  platform: string;
  isOpen: boolean;
  onClose: () => void;
  onMediaClick: (messageId: number) => void;
}

export default function MediaPanel({ threadId, platform, isOpen, onClose, onMediaClick }: MediaPanelProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && threadId) {
      fetchMedia();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, threadId]);

  async function fetchMedia() {
    setLoading(true);
    try {
      const res = await fetch(`/api/media-gallery?threadId=${encodeURIComponent(threadId)}`);
      const data = await res.json();
      setMedia(data.media || []);
    } catch (error) {
      console.error('Failed to fetch media:', error);
    } finally {
      setLoading(false);
    }
  }

  // Flatten media with month headers for VirtuosoGrid
  const gridData = useMemo(() => {
    const data: Array<{ type: 'header'; monthName: string } | { type: 'item'; item: MediaItem }> = [];

    let currentMonthKey = '';
    media.forEach((item) => {
      const date = new Date(item.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (monthKey !== currentMonthKey) {
        data.push({ type: 'header', monthName });
        currentMonthKey = monthKey;
      }

      data.push({ type: 'item', item });
    });

    return data;
  }, [media]);

  return (
    <div className={`${styles.mediaPanel} ${isOpen ? styles.open : ''}`}>
      <div className={styles.header}>
        <div className={styles.title}>Media files</div>
        <button className={styles.closeButton} aria-label="Close media panel" onClick={onClose}>
          <FaTimes size={18} />
        </button>
      </div>

      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>
            <FaSpinner className={styles.spinner} size={24} />
          </div>
        ) : media.length === 0 ? (
          <div className={styles.emptyState}>
            <FaImage className={styles.emptyIcon} />
            <div className={styles.emptyText}>No media in this conversation</div>
          </div>
        ) : (
          <VirtuosoGrid
            style={{ height: '100%' }}
            totalCount={gridData.length}
            overscan={200}
            components={{
              List: React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(function GridList(
                { style, children, ...props },
                ref,
              ) {
                return (
                  <div ref={ref} {...props} className={styles.gridList} style={style}>
                    {children}
                  </div>
                );
              }),
              Item: function Item({ children, ...props }: React.HTMLProps<HTMLDivElement> & { 'data-index'?: number }) {
                const index = props['data-index'] as number;
                const data = gridData[index];
                const isHeader = data?.type === 'header';

                return (
                  <div
                    {...props}
                    style={{
                      ...(isHeader && { gridColumn: '1 / -1' }),
                    }}
                  >
                    {children}
                  </div>
                );
              },
            }}
            itemContent={(index) => {
              const data = gridData[index];
              if (data.type === 'header') {
                return <div className={styles.monthHeader}>{data.monthName}</div>;
              }

              const { item } = data;
              const imageUrl = `/api/media?path=${encodeURIComponent(item.thumbnailUrl || item.mediaUrl)}&platform=${platform}`;

              return (
                <div className={styles.mediaThumbnail} onClick={() => onMediaClick(item.messageId)}>
                  {item.mediaType === 'video' ? (
                    <>
                      <video className={styles.thumbnailImage} preload="metadata" src={imageUrl} muted />
                      <div className={styles.videoOverlay}>
                        <FaPlay size={16} />
                      </div>
                    </>
                  ) : (
                    <img alt="Media" className={styles.thumbnailImage} loading="lazy" src={imageUrl} />
                  )}
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
