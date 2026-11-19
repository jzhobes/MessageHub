import React, { useCallback, useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import styles from './Tooltip.module.css';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delayMs?: number;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export default function Tooltip({
  content,
  children,
  delayMs = 160,
  placement = 'bottom',
  align = 'center',
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    actualPlacement: 'top' | 'bottom';
  } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl) {
      return;
    }
    const rect = triggerEl.getBoundingClientRect();
    const tooltipWidth = tooltipRef.current?.offsetWidth || 220;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 40;
    const gap = 9;

    let actualPlacement = placement;
    if (placement === 'bottom' && rect.bottom + gap + tooltipHeight > window.innerHeight - 8) {
      actualPlacement = 'top';
    } else if (placement === 'top' && rect.top - gap - tooltipHeight < 8) {
      actualPlacement = 'bottom';
    }

    const top = actualPlacement === 'bottom' ? rect.bottom + gap : Math.max(8, rect.top - gap - tooltipHeight);

    let desiredLeft: number;
    if (align === 'end') {
      desiredLeft = rect.right - tooltipWidth;
    } else if (align === 'start') {
      desiredLeft = rect.left;
    } else {
      desiredLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
    }

    const clampedLeft = Math.max(8, Math.min(desiredLeft, window.innerWidth - tooltipWidth - 8));
    const triggerCenterX = rect.left + rect.width / 2;
    const arrowLeft = Math.max(12, Math.min(triggerCenterX - clampedLeft, tooltipWidth - 12));

    setCoords({ top, left: clampedLeft, arrowLeft, actualPlacement });
  }, [placement, align]);

  const show = useCallback(() => {
    if (!content) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delayMs);
  }, [content, delayMs]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }
    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [visible, updatePosition, hide]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className={className ? `${styles.trigger} ${className}` : styles.trigger}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {visible &&
        content &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className={styles.tooltip}
            style={{
              top: coords ? coords.top : -9999,
              left: coords ? coords.left : -9999,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            {coords && (
              <span
                className={`${styles.arrow} ${coords.actualPlacement === 'bottom' ? styles.arrowTop : styles.arrowBottom}`}
                style={{ left: coords.arrowLeft }}
              />
            )}
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
