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
  open?: boolean; // Controlled mode
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
  gap?: number;
  onOpenChange?: (open: boolean) => void;
}

export function Dropdown({
  trigger,
  children,
  width,
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
  }, [isControlled, onOpenChange]);

  // Sync Popover API state
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    // Type casting because TypeScript definitions for popover might be missing depending on version
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
        /* Already open or not supported */
      }
    } else {
      try {
        popoverMenu.hidePopover();
      } catch {
        /* Already closed or not supported */
      }
    }

    return () => popoverMenu.removeEventListener('beforetoggle', handleToggle);
  }, [isOpen, close]);

  // Handle Positioning
  const updatePosition = useCallback(() => {
    if (isOpen && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const availableHeight = window.innerHeight - triggerRect.bottom - 20;

      // Handle width "100%" by measuring trigger
      const resolvedWidth = width === '100%' ? triggerRect.width : width || 160;
      const top = triggerRect.bottom + gap;
      const left =
        align === 'right'
          ? triggerRect.right - (typeof resolvedWidth === 'number' ? resolvedWidth : 160)
          : triggerRect.left;

      setMenuStyle({
        width: resolvedWidth,
        maxHeight: Math.max(100, availableHeight),
        '--dropdown-top': `${top}px`,
        '--dropdown-left': `${left}px`,
      } as React.CSSProperties);
    }
  }, [isOpen, width, align, gap]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true); // capture to catch nested scrolls
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
        onClick={toggle}
      >
        {trigger}
      </div>

      <div
        ref={menuRef}
        popover="auto"
        className={`${styles.dropdownMenu} ${menuClassName || ''}`}
        style={{ ...menuStyle, positionAnchor: anchorName } as React.CSSProperties}
        data-align={align}
      >
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownItemProps {
  children: React.ReactNode;
  className?: string;
  closeOnClick?: boolean; // Override for specific items
  disabled?: boolean;
  onClick?: () => void;
}

export function DropdownItem({ children, className, closeOnClick, disabled, onClick }: DropdownItemProps) {
  const ctx = useContext(DropdownContext);
  const itemRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) {
      return;
    }
    onClick?.();

    // Smart Close Logic
    // 1. If explicitly provided, respect the prop
    // 2. Otherwise, check if we contain an input/checkbox
    let shouldClose = closeOnClick;

    if (shouldClose === undefined) {
      const target = e.target as HTMLElement;
      const isInput = target.closest('input, textarea, select');
      const isLabel = target.closest('label');
      // If we clicked an input or a label, or the item contains an input, default to NOT closing
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
      className={`${styles.dropdownItem} ${className || ''}`}
      style={{
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: disabled ? 'not-allowed' : 'pointer',
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
