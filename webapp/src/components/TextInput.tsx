import React, { ReactNode } from 'react';
import styles from './TextInput.module.css';

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  adornment?: ReactNode;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ adornment, className, ...props }, ref) => {
    return (
      <div className={`${styles.inputWrapper} ${className || ''}`}>
        {adornment && <div className={styles.inputAdornment}>{adornment}</div>}
        <input ref={ref} className={styles.input} {...props} />
      </div>
    );
  },
);

TextInput.displayName = 'TextInput';

export default TextInput;
