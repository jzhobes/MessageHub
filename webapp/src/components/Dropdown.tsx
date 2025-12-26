import React, { useRef, useState, useEffect, useCallback, useContext } from 'react';
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
  onOpenChange?: (open: boolean) => void;
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
}

export function Dropdown({
  trigger,
  children,
  width,
  open,
  onOpenChange,
  align = 'left',
  className,
  menuClassName,
}: DropdownProps) {
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
    <DropdownContext.Provider value={{ close }}>
      <div ref={containerRef} className={className} style={{ position: 'relative' }}>
        <div onClick={toggle} style={{ display: 'flex', width: '100%', height: '100%', cursor: 'inherit' }}>
          {trigger}
        </div>

        {isOpen && (
          <div
            className={`${styles.dropdownMenu} ${menuClassName || ''}`}
            style={{
              width: width || 160,
              right: align === 'right' ? 0 : 'auto',
              left: align === 'left' ? 0 : 'auto',
              maxHeight,
            }}
          >
            {children}
          </div>
        )}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  closeOnClick?: boolean; // Override for specific items
  disabled?: boolean;
}

export function DropdownItem({ children, onClick, className, closeOnClick = true, disabled }: DropdownItemProps) {
  const ctx = useContext(DropdownContext);

  return (
    <div
      className={`${styles.dropdownItem} ${className || ''}`}
      style={{
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={(e) => {
        if (disabled) {
          return;
        }
        // e.stopPropagation(); // Removed so it can bubble if needed, but we handle closing manually now

        onClick?.();

        // Smart Close Logic
        if (closeOnClick) {
          const target = e.target as HTMLElement;

          // Check if we clicked a checkbox or a label associated with an input
          const isCheckbox = target.closest('input[type="checkbox"]');
          const isLabelWithInput = target.tagName === 'LABEL' && target.querySelector('input');
          const isInputInsideLabel = target.closest('label') && target.tagName === 'INPUT';

          if (!isCheckbox && !isLabelWithInput && !isInputInsideLabel) {
            ctx?.close();
          }
        }
      }}
    >
      {children}
    </div>
  );
}

export const DropdownDivider = () => <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />;
