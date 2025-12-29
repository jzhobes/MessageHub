import React from 'react';

import Link from 'next/link';
import { FaRobot } from 'react-icons/fa';

import PlatformIcon from '@/components/PlatformIcon';

import styles from './Sidebar.module.css';

interface SidebarProps {
  activePlatform: string;
  availability: Record<string, boolean>;
  collapsed: boolean;
  onPlatformSelect: (platform: string) => void;
}

const SIDEBAR_PLATFORMS = [
  { id: 'facebook', label: 'Facebook', size: 20 },
  { id: 'instagram', label: 'Instagram', size: 18 },
  { id: 'google_chat', label: 'Google Chat', size: 18 },
  { id: 'google_voice', label: 'Google Voice', size: 18 },
  { id: 'google_mail', label: 'Gmail', size: 18 },
];

export default function Sidebar({ activePlatform, availability, collapsed, onPlatformSelect }: SidebarProps) {
  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      {SIDEBAR_PLATFORMS.map((p) => {
        const isAvailable = availability[p.id];
        return (
          <button
            key={p.id}
            className={`${styles.navItem} ${activePlatform === p.id ? styles.navItemActive : ''}`}
            disabled={!isAvailable}
            title={collapsed ? p.label : ''}
            onClick={() => onPlatformSelect(p.id)}
          >
            <span className={styles.sidebarIconWrapper}>
              <PlatformIcon platform={p.id} active={isAvailable} size={p.size} />
            </span>
            <span className={styles.sidebarLabel}>{p.label}</span>
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
