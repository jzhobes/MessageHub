import React, { useEffect, ReactNode } from 'react';
import { FaTimes } from 'react-icons/fa';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import styles from './BaseModal.module.css';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  maxWidth?: string | number;
  height?: string | number;
  showClose?: boolean;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  headerClassName?: string;
  hideHeader?: boolean;
}

export default function BaseModal({
  isOpen,
  onClose,
  children,
  title,
  subtitle,
  maxWidth = 800,
  height = '80vh',
  showClose = true,
  className = '',
  overlayClassName = '',
  contentClassName = '',
  headerClassName = '',
  hideHeader = false,
}: BaseModalProps) {
  const { isMounted, isClosing } = useModalAnimation(isOpen, 300);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isMounted) {
    return null;
  }

  const maxWidthValue = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth;
  const heightValue = typeof height === 'number' ? `${height}px` : height;

  return (
    <div className={`${styles.overlay} ${isClosing ? styles.overlayClosing : ''} ${overlayClassName}`} onClick={onClose}>
      <div className={`${styles.modal} ${isClosing ? styles.modalClosing : ''} ${className}`} style={{ maxWidth: maxWidthValue, height: heightValue }} onClick={(e) => e.stopPropagation()}>
        {!hideHeader && (title || showClose) && (
          <div className={`${styles.header} ${headerClassName}`}>
            <div className={styles.titleGroup}>
              {title && <h2 className={styles.title}>{title}</h2>}
              {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
            </div>
            {showClose && (
              <button className={styles.closeButton} onClick={onClose} aria-label="Close modal">
                <FaTimes />
              </button>
            )}
          </div>
        )}
        <div className={`${styles.content} ${contentClassName}`}>{children}</div>
      </div>
    </div>
  );
}
