import React, { useCallback, useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import styles from './Tooltip.module.css';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delayMs?: number;
  placement?: 'top' | 'bottom' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  style?: React.CSSProperties;
}

export default function Tooltip({
  content,
  children,
  delayMs = 160,
  placement = 'bottom',
  align = 'center',
  className,
  style,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    arrowOffset: number;
    actualPlacement: 'top' | 'bottom' | 'right' | 'left';
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

    if (placement === 'right') {
      let actualPlacement: 'right' | 'left' = 'right';
      if (rect.right + gap + tooltipWidth > window.innerWidth - 8 && rect.left - gap - tooltipWidth >= 8) {
        actualPlacement = 'left';
      }

      const left =
        actualPlacement === 'right'
          ? Math.min(rect.right + gap, window.innerWidth - tooltipWidth - 8)
          : Math.max(8, rect.left - gap - tooltipWidth);

      const desiredTop = rect.top + rect.height / 2 - tooltipHeight / 2;
      const clampedTop = Math.max(8, Math.min(desiredTop, window.innerHeight - tooltipHeight - 8));
      const triggerCenterY = rect.top + rect.height / 2;
      const arrowOffset = Math.max(12, Math.min(triggerCenterY - clampedTop, tooltipHeight - 12));

      setCoords({ top: clampedTop, left, arrowOffset, actualPlacement });
      return;
    }

    let actualPlacement: 'top' | 'bottom' = placement;
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
    const arrowOffset = Math.max(12, Math.min(triggerCenterX - clampedLeft, tooltipWidth - 12));

    setCoords({ top, left: clampedLeft, arrowOffset, actualPlacement });
  }, [placement, align]);

  const show = useCallback(() => {
    if (!content) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      const container = triggerRef.current?.closest('dialog[open]') ?? document.body;
      setPortalTarget(container);
      setVisible(true);
    }, delayMs);
  }, [content, delayMs]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
    setCoords(null);
  }, []);

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      try {
        if (e.target.matches(':focus-visible')) {
          show();
        }
      } catch {
        // Some environments don't support :focus-visible.
      }
    },
    [show],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const tooltipEl = tooltipRef.current as
      (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;

    if (tooltipEl && typeof tooltipEl.showPopover === 'function') {
      try {
        tooltipEl.showPopover();
      } catch {
        // The browser may reject showPopover or lack popover="hint" support.
      }
    }

    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);

    const handleToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') {
        hide();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hide();
      }
    };

    tooltipEl?.addEventListener('toggle', handleToggle);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      cancelAnimationFrame(rafId);
      tooltipEl?.removeEventListener('toggle', handleToggle);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      if (tooltipEl && typeof tooltipEl.hidePopover === 'function') {
        try {
          tooltipEl.hidePopover();
        } catch {
          // The popover may have closed already.
        }
      }
    };
  }, [visible, updatePosition, hide]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const getArrowProps = () => {
    if (!coords) {
      return null;
    }
    if (coords.actualPlacement === 'right') {
      return { className: `${styles.arrow} ${styles.arrowLeft}`, style: { top: coords.arrowOffset } };
    }
    if (coords.actualPlacement === 'left') {
      return { className: `${styles.arrow} ${styles.arrowRight}`, style: { top: coords.arrowOffset } };
    }
    if (coords.actualPlacement === 'bottom') {
      return { className: `${styles.arrow} ${styles.arrowTop}`, style: { left: coords.arrowOffset } };
    }
    return { className: `${styles.arrow} ${styles.arrowBottom}`, style: { left: coords.arrowOffset } };
  };

  const arrowProps = getArrowProps();

  return (
    <>
      <span
        ref={triggerRef}
        className={className ? `${styles.trigger} ${className}` : styles.trigger}
        style={style}
        onMouseEnter={show}
        onMouseLeave={hide}
        onMouseDown={hide}
        onFocus={handleFocus}
        onBlur={hide}
      >
        {children}
      </span>
      {visible &&
        content &&
        portalTarget &&
        createPortal(
          <div
            ref={tooltipRef}
            popover="hint"
            role="tooltip"
            className={styles.tooltip}
            style={{
              top: coords ? coords.top : -9999,
              left: coords ? coords.left : -9999,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            {arrowProps && <span className={arrowProps.className} style={arrowProps.style} />}
            {content}
          </div>,
          portalTarget,
        )}
    </>
  );
}
