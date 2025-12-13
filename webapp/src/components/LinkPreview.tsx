import React, { useState, useEffect, useRef, useCallback } from 'react';
import LazyView from './LazyView';
import styles from '../styles/index.module.css';

interface LinkPreviewProps {
  url: string;
  isMyMsg: boolean; // required to determine radius class
  suppressImage?: boolean;
}

export default function LinkPreview({ url, isMyMsg, suppressImage }: LinkPreviewProps) {
  const [data, setData] = useState<{ image?: string; title?: string; description?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  // Determine radius class based on sender
  const radiusClass = isMyMsg ? styles.previewBubbleSent : styles.previewBubbleReceived;

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchPreview = useCallback(async () => {
    try {
      const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
      if (res.ok) {
        const json = await res.json();
        if (isMounted.current) {
          setData(json);
        }
      }
    } catch (e) {
      console.error('Preview fetch error', e);
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [url]);

  if (loading) {
    return (
      <LazyView onEnter={fetchPreview} rootMargin="50px" className={`${styles.linkPreviewLazy} ${radiusClass}`}>
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.linkPreviewLink}>
          {url}
        </a>
        <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '4px' }}>Loading preview...</div>
      </LazyView>
    );
  }

  // Render logic
  const hasImage = data && data.image && !suppressImage;
  const hasTitle = data && (data.title || data.description);

  if (!loading && !hasImage && !hasTitle) {
    // Fallback - don't show separate bubble, just let the text link stand alone
    return null;
  }

  // If we have data
  if (hasImage || hasTitle) {
    return (
      <div className={`${styles.linkPreviewCard} ${radiusClass}`}>
        {/* Preview Image */}
        {hasImage && data?.image && (
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%' }}>
            <img
              src={data.image}
              alt="Preview"
              className={styles.linkPreviewImage}
              style={{
                borderBottom: hasTitle ? '1px solid #eee' : 'none',
              }}
            />
          </a>
        )}

        {/* Text Content */}
        {hasTitle && <div className={styles.linkPreviewTitleArea}>{data?.title && <div className={styles.linkPreviewTitle}>{data.title}</div>}</div>}
      </div>
    );
  }

  return null;
}
