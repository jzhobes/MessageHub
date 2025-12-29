import React from 'react';

import { FaSpinner } from 'react-icons/fa';

import styles from './LoadingSplash.module.css';

export default function LoadingSplash() {
  return (
    <div className={styles.splashContainer}>
      <FaSpinner className={styles.spinner} size={48} />
      <div className={styles.header}>
        <div className={styles.logo}>💬</div>
        <div className={styles.title}>MessageHub</div>
      </div>
    </div>
  );
}
