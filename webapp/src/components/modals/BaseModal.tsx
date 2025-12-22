import React, { useEffect, ReactNode } from 'react';
import { FaTimes } from 'react-icons/fa';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import styles from './BaseModal.module.css';

export interface BaseModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onAfterClose?: () => void;
  children: ReactNode;
  maxWidth?: string | number;
  height?: string | number;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  dismissible?: boolean;
}

export function ModalHeader({
  children,
  className = '',
  onClose,
}: {
  children?: ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <div className={`${styles.header} ${className}`}>
      <div className={styles.titleGroup}>{children}</div>
      {onClose && (
        <button className={styles.closeButton} onClick={() => onClose()} aria-label="Close modal" disabled={!onClose}>
          <FaTimes />
        </button>
      )}
    </div>
  );
}

export default function BaseModal({
  isOpen,
  onClose,
  onAfterClose,
  children,
  maxWidth = 800,
  height = '80vh',
  className = '',
  overlayClassName = '',
  contentClassName = '',
  dismissible = true,
}: BaseModalProps) {
  const { isMounted, isClosing } = useModalAnimation(isOpen, 300);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen || !dismissible || !onClose) {
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, dismissible]);

  // Trigger onAfterClose when close animation finished
  useEffect(() => {
    if (!isMounted && !isOpen) {
      onAfterClose?.();
    }
  }, [isMounted, isOpen, onAfterClose]);

  if (!isMounted) {
    return null;
  }

  const maxWidthValue = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth;
  const heightValue = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`${styles.overlay} ${isClosing ? styles.overlayClosing : ''} ${overlayClassName}`}
      onClick={() => {
        if (dismissible && onClose) {
          onClose();
        }
      }}
    >
      <div
        className={`${styles.modal} ${isClosing ? styles.modalClosing : ''} ${className}`}
        style={{ maxWidth: maxWidthValue, height: heightValue }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${styles.content} ${contentClassName}`}>{children}</div>
      </div>
    </div>
  );
}
