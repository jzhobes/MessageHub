import React, { useRef, useState, useEffect, useCallback } from 'react';
import styles from '@/pages/studio.module.css'; // Re-using existing studio styles for now

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  open?: boolean; // Controlled mode
  onOpenChange?: (open: boolean) => void;
  align?: 'left' | 'right';
  className?: string;
}

export function Dropdown({ trigger, children, width, open, onOpenChange, align = 'left', className }: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState('400px');
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

  const updateMaxHeight = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const availableHeight = window.innerHeight - rect.bottom - 20;
      setMaxHeight(`${Math.max(100, availableHeight)}px`);
    }
  }, []);

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

  useEffect(() => {
    if (isOpen) {
      updateMaxHeight();
      window.addEventListener('resize', updateMaxHeight);
      return () => window.removeEventListener('resize', updateMaxHeight);
    }
  }, [isOpen, updateMaxHeight]);

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative' }}>
      <div onClick={toggle} style={{ display: 'flex', height: '100%', cursor: 'inherit' }}>
        {trigger}
      </div>

      {isOpen && (
        <div
          className={styles.dropdownMenu}
          style={{
            width: width || 160,
            right: align === 'right' ? 0 : 'auto',
            left: align === 'left' ? 0 : 'auto',
            maxHeight,
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
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </div>
  );
}

export const DropdownDivider = () => <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />;
