import React, { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

import styles from './Dropdown.module.css';

interface DropdownContextValue {
  close: () => void;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  width?: number | string;
  minWidth?: number | string | 'trigger';
  open?: boolean; // Controlled mode
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
  gap?: number;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Use the native Popover API with CSS anchors and a viewport fallback in JS.
 * Supports controlled (`open`) and uncontrolled state, plus ArrowUp, ArrowDown, Home, End, Enter,
 * Space, Escape, and Tab.
 * Wait 150ms after dismissal so clicking the trigger to close doesn't immediately reopen it.
 */
export function Dropdown({
  trigger,
  children,
  width,
  minWidth,
  open,
  align = 'left',
  className,
  menuClassName,
  gap = 4,
  onOpenChange,
}: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastClosedTime = useRef(0);
  const id = useId();
  const anchorName = `--anchor-${id.replace(/:/g, '')}`;

  const toggle = useCallback(() => {
    if (Date.now() - lastClosedTime.current < 150) {
      return;
    }
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  }, [isOpen, isControlled, onOpenChange]);

  const close = useCallback(() => {
    if (!isControlled) {
      setInternalOpen(false);
    }
    onOpenChange?.(false);
    // Return focus to trigger when closing
    triggerRef.current?.focus();
  }, [isControlled, onOpenChange]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (!isOpen) {
        e.preventDefault();
        toggle();
        // Wait until the menu opens before moving focus inside.
        setTimeout(() => {
          const items = menuRef.current?.querySelectorAll<HTMLElement>(`.${styles.dropdownItem}:not([disabled])`);
          if (items && items.length > 0) {
            if (e.key === 'ArrowUp') {
              items[items.length - 1].focus();
            } else {
              items[0].focus();
            }
          }
        }, 50);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // If it's already open, just move focus.
        e.preventDefault();
        const items = menuRef.current?.querySelectorAll<HTMLElement>(`.${styles.dropdownItem}:not([disabled])`);
        if (items && items.length > 0) {
          if (e.key === 'ArrowUp') {
            items[items.length - 1].focus();
          } else {
            items[0].focus();
          }
        }
      }
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(`.${styles.dropdownItem}:not([disabled])`) || [],
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (currentIndex === -1) {
          items[0]?.focus();
        } else {
          const nextIndex = (currentIndex + 1) % items.length;
          items[nextIndex]?.focus();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (currentIndex === -1) {
          items[items.length - 1]?.focus();
        } else {
          const prevIndex = (currentIndex - 1 + items.length) % items.length;
          items[prevIndex]?.focus();
        }
        break;
      case 'Home':
        e.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Enter':
      case ' ':
        if (currentIndex !== -1) {
          e.preventDefault();
          items[currentIndex].click();
        }
        break;
      case 'Tab':
        // Close explicitly so the component state stays in sync with the native popover.
        close();
        break;
    }
  };

  // Sync Popover API state
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    // Some TypeScript versions don't include the popover API in their DOM types.
    const popoverMenu = menu as HTMLElement & { showPopover(): void; hidePopover(): void };

    const handleToggle = (e: Event & { newState: string }) => {
      if (e.newState === 'closed') {
        lastClosedTime.current = Date.now();
        if (isOpen) {
          close();
        }
      }
    };

    popoverMenu.addEventListener('beforetoggle', handleToggle);

    if (isOpen) {
      try {
        popoverMenu.showPopover();
      } catch {
        // Fall back if the browser can't show it or it's already open.
      }
    } else {
      try {
        popoverMenu.hidePopover();
      } catch {
        // Fall back if the browser can't hide it or it's already closed.
      }
    }

    return () => popoverMenu.removeEventListener('beforetoggle', handleToggle);
  }, [isOpen, close]);

  // Handle Positioning
  const updatePosition = useCallback(() => {
    if (isOpen && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const availableHeight = window.innerHeight - triggerRect.bottom - 20;

      // Measure the trigger when the menu should be the same width.
      const resolvedWidth = width === '100%' ? triggerRect.width : width || 160;
      const resolvedMinWidth = minWidth === 'trigger' ? triggerRect.width : minWidth;
      const top = triggerRect.bottom + gap;
      const left =
        align === 'right'
          ? triggerRect.right - (typeof resolvedWidth === 'number' ? resolvedWidth : 160)
          : triggerRect.left;

      setMenuStyle({
        width: resolvedWidth,
        minWidth: resolvedMinWidth,
        maxHeight: Math.max(100, availableHeight),
        '--dropdown-top': `${top}px`,
        '--dropdown-left': `${left}px`,
      } as React.CSSProperties);
    }
  }, [isOpen, width, minWidth, align, gap]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true); // Use capture so scroll events from nested containers reach us.
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [isOpen, updatePosition]);

  return (
    <DropdownContext.Provider value={{ close }}>
      <div
        ref={triggerRef}
        className={className}
        style={{ cursor: 'pointer', anchorName } as React.CSSProperties}
        role="button"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
      >
        {trigger}
      </div>

      <div
        ref={menuRef}
        popover="auto"
        role="menu"
        className={`${styles.dropdownMenu} ${menuClassName || ''}`}
        style={{ ...menuStyle, positionAnchor: anchorName } as React.CSSProperties}
        data-align={align}
        onKeyDown={handleMenuKeyDown}
      >
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownItemProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  closeOnClick?: boolean; // Override for specific items
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * Close the parent dropdown on click by default. Honor an explicit `closeOnClick` value. Otherwise,
 * keep it open when the click is in a form control or label, or the item contains a form control.
 */
export function DropdownItem({ children, className, style, closeOnClick, disabled, onClick }: DropdownItemProps) {
  const ctx = useContext(DropdownContext);
  const itemRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) {
      return;
    }
    onClick?.();

    // Decide whether the click should close the menu.
    // Use the prop when the caller sets it.
    // Otherwise, check for form controls.
    let shouldClose = closeOnClick;

    if (shouldClose === undefined) {
      const target = e.target as HTMLElement;
      const isInput = target.closest('input, textarea, select');
      const isLabel = target.closest('label');
      // Leave the menu open while someone is using a control or its label.
      if (isInput || isLabel || itemRef.current?.querySelector('input, textarea, select')) {
        shouldClose = false;
      } else {
        shouldClose = true;
      }
    }

    if (shouldClose) {
      ctx?.close();
    }
  };

  return (
    <div
      ref={itemRef}
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      className={`${styles.dropdownItem} ${className || ''}`}
      style={{
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

export function DropdownDivider() {
  return <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />;
}
