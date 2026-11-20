import React, { useCallback, useEffect, useRef, useState } from 'react';

import LazyView from '@/components/LazyView';

import { apiFetch } from '@/lib/client/apiClient';

import styles from './LinkPreview.module.css';

interface PreviewData {
  image?: string;
  title?: string;
  description?: string;
}

const MAX_CACHE_ENTRIES = 500;
const previewCache = new Map<string, PreviewData | null>();

function setCachedPreview(url: string, value: PreviewData | null) {
  if (previewCache.size >= MAX_CACHE_ENTRIES && !previewCache.has(url)) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey !== undefined) {
      previewCache.delete(oldestKey);
    }
  }
  previewCache.set(url, value);
}

export function clearLinkPreviewCache() {
  previewCache.clear();
}

interface LinkPreviewProps {
  url: string;
}

export default function LinkPreview({ url }: LinkPreviewProps) {
  const isDirectImage = /\.(gif|jpe?g|png|webp)($|\?)/i.test(url);
  const hasCached = !isDirectImage && previewCache.has(url);
  const cachedData = hasCached ? (previewCache.get(url) ?? null) : null;

  const [data, setData] = useState<PreviewData | null>(cachedData);
  const [loading, setLoading] = useState(!isDirectImage && !hasCached);
  const isMounted = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const fetchPreview = useCallback(async () => {
    if (previewCache.has(url)) {
      setData(previewCache.get(url) ?? null);
      setLoading(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await apiFetch(`/api/preview?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      if (res.ok) {
        const json: PreviewData = await res.json();
        setCachedPreview(url, json);
        if (!controller.signal.aborted && isMounted.current) {
          setData(json);
        }
      } else {
        setCachedPreview(url, null);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      console.error('Preview fetch error', e);
      setCachedPreview(url, null);
    } finally {
      if (!controller.signal.aborted && isMounted.current) {
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
    // If there's no preview, leave the link in the message on its own.
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
