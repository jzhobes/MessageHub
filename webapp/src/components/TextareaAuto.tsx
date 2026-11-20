import React, { useCallback, useEffect, useRef } from 'react';

import styles from '@/pages/studio.module.css';

interface TextareaAutoProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  maxRows?: number;
}

export default function TextareaAuto({
  minRows = 3,
  maxRows = 8,
  className,
  value,
  onChange,
  style,
  ...props
}: TextareaAutoProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    // Reset the height first so scrollHeight can shrink with the text.
    textarea.style.height = 'auto';

    const lineHeight = 20; // Estimate the line height from the font size.
    const minHeight = minRows * lineHeight;
    const maxHeight = maxRows * lineHeight;

    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);

    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'; // Only scroll once the textarea reaches its height limit.
  }, [minRows, maxRows]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      className={`${styles.input} ${className || ''}`} // Compose base styles
      value={value}
      style={{
        resize: 'none',
        overflow: 'hidden',
        minHeight: `${minRows * 20}px`,
        ...style,
      }}
      rows={minRows}
      onChange={(e) => {
        onChange?.(e);
        adjustHeight();
      }}
      {...props}
    />
  );
}
