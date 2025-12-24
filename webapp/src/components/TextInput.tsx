import React, { ReactNode, forwardRef } from 'react';
import styles from './TextInput.module.css';

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  adornment?: ReactNode; // Standard prefix adornment
  suffix?: ReactNode; // Suffix adornment for actions/icons at the end
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ adornment, suffix, className, ...props }, ref) => {
    return (
      <div className={`${styles.inputWrapper} ${className || ''}`}>
        {adornment && <div className={`${styles.adornment} ${styles.start}`}>{adornment}</div>}
        <input ref={ref} className={styles.input} {...props} />
        {suffix && <div className={`${styles.adornment} ${styles.end}`}>{suffix}</div>}
      </div>
    );
  },
);

TextInput.displayName = 'TextInput';

export default TextInput;
