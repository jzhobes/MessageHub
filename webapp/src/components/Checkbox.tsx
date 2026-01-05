import React from 'react';

import styles from './Checkbox.module.css';

interface CheckboxProps {
  checked: boolean;
  label: React.ReactNode;
  description?: string;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  onChange: (checked: boolean) => void;
}

export default function Checkbox({ checked, label, description, id, className, style, onChange }: CheckboxProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };

  return (
    <div className={`${styles.container} ${className || ''}`} style={style}>
      <div className={styles.row}>
        <input type="checkbox" id={id} checked={checked} className={styles.input} onChange={handleChange} />
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      </div>
      {description && <div className={styles.description}>{description}</div>}
    </div>
  );
}
