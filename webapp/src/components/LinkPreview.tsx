import React, { useCallback, useEffect, useRef, useState } from 'react';

import LazyView from './LazyView';
import styles from './LinkPreview.module.css';

interface LinkPreviewProps {
  url: string;
}

export default function LinkPreview({ url }: LinkPreviewProps) {
  const isDirectImage = /\.(gif|jpe?g|png|webp)($|\?)/i.test(url);

  const [data, setData] = useState<{ image?: string; title?: string; description?: string } | null>(null);
  const [loading, setLoading] = useState(!isDirectImage);
  const isMounted = useRef(true);

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

  if (isDirectImage) {
    return (
      <div className={`${styles.container} previewContainer`}>
        <img src={url} alt="Shared Image" className={styles.linkPreviewImage} loading="lazy" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${styles.container} previewContainer`}>
        <LazyView rootMargin="50px" className={`linkPreview ${styles.linkPreviewLazy}`} onEnter={fetchPreview}>
          <a href={url} target="_blank" rel="noopener noreferrer" className={styles.linkPreviewLink}>
            {url}
          </a>
          <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '4px' }}>Loading preview...</div>
        </LazyView>
      </div>
    );
  }

  // Render logic
  const hasImage = data?.image;
  const textContent = data?.title || data?.description;

  if (!loading && !hasImage && !textContent) {
    // Fallback - don't show separate bubble, just let the text link stand alone
    return null;
  }

  // If we have data
  if (hasImage || textContent) {
    return (
      <div className={`${styles.container} previewContainer`}>
        <div className={`linkPreview ${styles.linkPreviewCard}`}>
          {/* Preview Image */}
          {hasImage && data?.image && (
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%' }}>
              <img
                src={data.image}
                alt="Preview"
                className={styles.linkPreviewImage}
                style={{
                  borderBottom: textContent ? '1px solid #eee' : 'none',
                }}
              />
            </a>
          )}

          {/* Text Content */}
          {textContent && (
            <div className={styles.linkPreviewTitleArea}>
              <div className={styles.linkPreviewTitle}>{textContent}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
