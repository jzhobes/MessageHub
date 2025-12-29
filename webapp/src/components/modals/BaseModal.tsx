import React, { ReactNode, useContext, useEffect, useRef, useState } from 'react';

import { FaTimes } from 'react-icons/fa';

import { useModalAnimation } from '@/hooks/useModalAnimation';

import styles from './BaseModal.module.css';

const BaseModalContext = React.createContext({ isReady: false });

export interface BaseModalProps {
  isOpen: boolean;
  children: ReactNode;
  maxWidth?: string | number;
  height?: string | number;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  dismissible?: boolean;
  onClose?: () => void;
  onAfterClose?: () => void;
}

export function ModalHeader({
  children,
  className = '',
  disabled = false,
  onClose,
}: {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClose?: () => void;
}) {
  const { isReady } = useContext(BaseModalContext);

  return (
    <div className={`${styles.header} ${className}`}>
      <div className={styles.titleGroup}>{children}</div>
      {onClose && (
        <button
          className={styles.closeButton}
          aria-label="Close modal"
          disabled={disabled || !isReady || !onClose}
          onClick={() => onClose()}
        >
          <FaTimes />
        </button>
      )}
    </div>
  );
}

export default function BaseModal({
  isOpen,
  children,
  maxWidth = 800,
  height = '80vh',
  className = '',
  overlayClassName = '',
  contentClassName = '',
  dismissible = true,
  onClose,
  onAfterClose,
}: BaseModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isReady, setIsReady] = useState(false);
  const { isMounted, isClosing } = useModalAnimation(isOpen, 300);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (isMounted && !dialog.open) {
      dialog.showModal();
      // Delay enabling the close button slightly to let
      // the browser's initial focus scan hit the content first.
      const timer = setTimeout(() => setIsReady(true), 10);
      return () => clearTimeout(timer);
    } else if (!isMounted && dialog.open) {
      dialog.close();
    }
  }, [isMounted]);

  // Handle native cancel (Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const handleCancel = (e: Event) => {
      e.preventDefault(); // Prevent default to handle close via state
      if (dismissible && onClose) {
        onClose();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [dismissible, onClose]);

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

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!dismissible || !onClose) {
      return;
    }
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${isClosing ? styles.dialogClosing : ''} ${overlayClassName}`}
      onClick={handleBackdropClick}
    >
      <div
        className={`${styles.modal} ${isClosing ? styles.modalClosing : ''} ${className}`}
        style={{ maxWidth: maxWidthValue, height: heightValue }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${styles.content} ${contentClassName}`}>
          <BaseModalContext.Provider value={{ isReady }}>{children}</BaseModalContext.Provider>
        </div>
      </div>
    </dialog>
  );
}
