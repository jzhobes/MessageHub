import React from 'react';

import Link from 'next/link';
import { FaFacebook, FaInstagram, FaPhone, FaRobot } from 'react-icons/fa';
import { SiGmail, SiGooglechat } from 'react-icons/si';

import styles from './Sidebar.module.css';

interface SidebarProps {
  activePlatform: string;
  availability: Record<string, boolean>;
  collapsed: boolean;
  onPlatformSelect: (platform: string) => void;
}

export default function Sidebar({ activePlatform, availability, collapsed, onPlatformSelect }: SidebarProps) {
  const platforms = [
    { name: 'Facebook', icon: <FaFacebook color={availability['Facebook'] ? '#1877F2' : '#666'} size={20} /> },
    { name: 'Instagram', icon: <FaInstagram color={availability['Instagram'] ? '#E4405F' : '#666'} size={18} /> },
    { name: 'Google Chat', icon: <SiGooglechat color={availability['Google Chat'] ? '#00AC47' : '#666'} size={18} /> },
    { name: 'Google Voice', icon: <FaPhone color={availability['Google Voice'] ? '#34A853' : '#666'} size={18} /> },
    { name: 'Gmail', icon: <SiGmail color={availability['Gmail'] ? '#EA4335' : '#666'} size={18} /> },
  ];

  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      {platforms.map((p) => {
        const isAvailable = availability[p.name];
        return (
          <button
            key={p.name}
            className={`${styles.navItem} ${activePlatform === p.name ? styles.navItemActive : ''}`}
            disabled={!isAvailable}
            title={collapsed ? p.name : ''}
            onClick={() => onPlatformSelect(p.name)}
          >
            <span className={styles.sidebarIconWrapper}>{p.icon}</span>
            <span className={styles.sidebarLabel}>{p.name}</span>
          </button>
        );
      })}

      <div style={{ padding: '0 12px', marginTop: 12, marginBottom: 12 }}>
        <div style={{ height: 1, backgroundColor: 'var(--border-subtle)', width: '100%' }} />
      </div>

      <div className={styles.navItem}>
        <Link
          href="/studio"
          className={styles.sidebarButton}
          style={{ textDecoration: 'none', color: 'inherit' }}
          title="DataForge AI"
        >
          <span className={styles.sidebarIconWrapper}>
            <FaRobot color="#666" size={20} />
          </span>
          <span className={styles.sidebarLabel}>DataForge AI</span>
        </Link>
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}
