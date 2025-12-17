import React from 'react';
import styles from './Checkbox.module.css';

interface CheckboxProps {
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  className?: string;
  description?: string;
  style?: React.CSSProperties;
}

export default function Checkbox({ label, checked, onChange, id, className, description, style }: CheckboxProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };

  return (
    <div className={`${styles.container} ${className || ''}`} style={style}>
      <div className={styles.row}>
        <input type="checkbox" id={id} checked={checked} onChange={handleChange} className={styles.input} />
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      </div>
      {description && <div className={styles.description}>{description}</div>}
    </div>
  );
}
