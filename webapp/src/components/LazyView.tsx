import React, { useEffect, useRef, useState } from 'react';

interface LazyViewProps {
  children?: React.ReactNode | ((inView: boolean) => React.ReactNode);
  onEnter?: () => void;
  rootMargin?: string;
  threshold?: number | number[];
  triggerOnce?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function LazyView({
  children,
  onEnter,
  rootMargin = '0px',
  threshold = 0,
  triggerOnce = true,
  style,
  className,
}: LazyViewProps) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (onEnter) {
            onEnter();
          }
          if (triggerOnce) {
            observer.disconnect();
          }
        } else {
          if (!triggerOnce) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [rootMargin, threshold, triggerOnce, onEnter]);

  return (
    <div ref={ref} style={style} className={className}>
      {typeof children === 'function' ? (children as (inView: boolean) => React.ReactNode)(inView) : children}
    </div>
  );
}
