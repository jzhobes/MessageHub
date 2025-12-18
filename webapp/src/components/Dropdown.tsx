import React, { useRef, useState, useEffect, useCallback } from 'react';
import styles from '@/pages/studio.module.css'; // Re-using existing studio styles for now

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  open?: boolean; // Controlled mode
  onOpenChange?: (open: boolean) => void;
  align?: 'left' | 'right';
}

export function Dropdown({ trigger, children, width, open, onOpenChange, align = 'left' }: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
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

  // Close on click outside
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, close]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div onClick={toggle} style={{ display: 'inline-block' }}>
        {trigger}
      </div>

      {isOpen && (
        <div
          className={styles.dropdownMenu}
          style={{
            width: width || 160,
            right: align === 'right' ? 0 : 'auto',
            left: align === 'left' ? 0 : 'auto',
          }}
        >
          {/* Inject close handler into children if they are standard divs? 
              For now just render children directly. Consumers handle their own click-to-close logic if item clicked. 
          */}
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function DropdownItem({ children, onClick, className }: DropdownItemProps) {
  return (
    <div
      className={className || styles.dropdownItem}
      onClick={(e) => {
        e.stopPropagation(); // Prevent re-triggering parent but we want to close?
        // Actually usually we want the click to propagate so the outside listener doesn't fire?
        // Wait, standard behavior is item click usually closes.
        onClick?.();
      }}
    >
      {children}
    </div>
  );
}

export const DropdownDivider = () => <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />;
