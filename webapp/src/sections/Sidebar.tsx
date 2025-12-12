import React from 'react';
import { FaFacebook, FaInstagram, FaPhone } from 'react-icons/fa';
import { SiGooglechat } from 'react-icons/si';
import styles from '../styles/index.module.css';

interface SidebarProps {
  activePlatform: string;
  onPlatformSelect: (platform: string) => void;
  availability: Record<string, boolean>;
}

export default function Sidebar({ activePlatform, onPlatformSelect, availability }: SidebarProps) {
  const platforms = [
    { name: 'Facebook', icon: <FaFacebook size={20} color={availability['Facebook'] ? '#1877F2' : '#666'} /> },
    { name: 'Instagram', icon: <FaInstagram size={18} color={availability['Instagram'] ? '#E4405F' : '#666'} /> },
    { name: 'Google Chat', icon: <SiGooglechat size={18} color={availability['Google Chat'] ? '#00AC47' : '#666'} /> },
    { name: 'Google Voice', icon: <FaPhone size={18} color={availability['Google Voice'] ? '#34A853' : '#666'} /> },
  ];

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarTitle}>💬 MessageHub</div>
      {platforms.map((p) => {
        const isAvailable = availability[p.name];
        return (
          <div key={p.name} className={`${styles.navItem} ${activePlatform === p.name ? styles.navItemActive : ''} ${!isAvailable ? styles.navItemDisabled : ''}`}>
            <button
              className={styles.sidebarButton}
              onClick={() => isAvailable && onPlatformSelect(p.name)}
              disabled={!isAvailable}
              style={{ cursor: isAvailable ? 'pointer' : 'not-allowed', opacity: isAvailable ? 1 : 0.5 }}
              onKeyDown={(e) => {
                if (isAvailable && (e.key === 'Enter' || e.key === ' ')) {
                  onPlatformSelect(p.name);
                }
              }}
            >
              <span className={styles.sidebarIconWrapper}>{p.icon}</span>
              {p.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
