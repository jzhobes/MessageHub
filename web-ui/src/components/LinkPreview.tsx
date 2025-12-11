import React, { useState, useEffect, useRef, useCallback } from 'react';
import LazyView from './LazyView';

export default function LinkPreview({ url, style }: { url: string; style?: React.CSSProperties }) {
  const [data, setData] = useState<{ image?: string; title?: string; description?: string } | null>(null);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return (
      <LazyView
        onEnter={fetchPreview}
        rootMargin="50px"
        style={{
          marginTop: '0',
          padding: '10px',
          backgroundColor: '#fff',
          borderRadius: '12px',
          border: '1px solid #e5e5ea',
          fontSize: '0.9rem',
          maxWidth: '300px',
          ...style,
        }}
      >
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#007aff', textDecoration: 'none' }}>
          {url}
        </a>
        <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '4px' }}>Loading preview...</div>
      </LazyView>
    );
  }

  // Render logic
  const hasImage = data && data.image;
  const hasTitle = data && (data.title || data.description);

  if (!loading && !hasImage && !hasTitle) {
    // Fallback: Just show the URL as a card so it's not invisible
    return (
      <div
        style={{
          margin: '0',
          width: '100%',
          maxWidth: '300px', // Strict width for fallback too
          borderRadius: '12px',
          border: '1px solid #e5e5ea',
          backgroundColor: '#fff',
          padding: '10px',
          ...style,
        }}
      >
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#007aff', textDecoration: 'none', wordBreak: 'break-all', fontSize: '0.9rem' }}>
          {url}
        </a>
      </div>
    );
  }

  // If we have data (image OR title), render visually rich card
  if (hasImage || hasTitle) {
    return (
      <div
        style={{
          margin: '0',
          width: '100%',
          maxWidth: '300px', // Strict width as requested
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #e5e5ea',
          display: 'flex',
          flexDirection: 'column',
          ...style,
        }}
      >
        {/* Preview Image */}
        {hasImage && data?.image && (
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%' }}>
            <img
              src={data.image}
              alt="Preview"
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
                borderBottom: hasTitle ? '1px solid #eee' : 'none',
              }}
            />
          </a>
        )}

        {/* Text Content */}
        {hasTitle && (
          <div style={{ padding: '10px 12px', backgroundColor: '#f0f0f5' }}>
            {data?.title && (
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#000' }}>{data.title}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
