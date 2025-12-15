import { FaFacebook, FaInstagram, FaPhone, FaMoon, FaSun } from 'react-icons/fa';
import { SiGooglechat } from 'react-icons/si';
import styles from './Sidebar.module.css';

interface SidebarProps {
  activePlatform: string;
  onPlatformSelect: (platform: string) => void;
  availability: Record<string, boolean>;
  theme: string;
  onToggleTheme: () => void;
  collapsed: boolean;
}

export default function Sidebar({ activePlatform, onPlatformSelect, availability, theme, onToggleTheme, collapsed }: SidebarProps) {
  const platforms = [
    { name: 'Facebook', icon: <FaFacebook size={20} color={availability['Facebook'] ? '#1877F2' : '#666'} /> },
    { name: 'Instagram', icon: <FaInstagram size={18} color={availability['Instagram'] ? '#E4405F' : '#666'} /> },
    { name: 'Google Chat', icon: <SiGooglechat size={18} color={availability['Google Chat'] ? '#00AC47' : '#666'} /> },
    { name: 'Google Voice', icon: <FaPhone size={18} color={availability['Google Voice'] ? '#34A853' : '#666'} /> },
  ];

  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      {platforms.map((p) => {
        const isAvailable = availability[p.name];
        return (
          <div
            key={p.name}
            className={`${styles.navItem} ${activePlatform === p.name ? styles.navItemActive : ''} ${!isAvailable ? styles.navItemDisabled : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => isAvailable && onPlatformSelect(p.name)}
            onKeyDown={(e) => {
              if (isAvailable && (e.key === 'Enter' || e.key === ' ')) {
                onPlatformSelect(p.name);
              }
            }}
            style={{
              cursor: isAvailable ? 'pointer' : 'not-allowed',
              opacity: isAvailable ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <span className={styles.sidebarButton} title={collapsed ? p.name : ''}>
              <span className={styles.sidebarIconWrapper} style={{ flexShrink: 0 }}>
                {p.icon}
              </span>
              <span className={styles.sidebarLabel}>{p.name}</span>
            </span>
          </div>
        );
      })}

      {/* Spacer to push bottom items (like Theme Toggle) to the footer area */}
      <div style={{ flex: 1 }} />

      <div className={styles.navItem}>
        <button className={styles.sidebarButton} onClick={onToggleTheme} style={{ justifyContent: 'flex-start' }} title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
          <span className={styles.sidebarIconWrapper} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, flexShrink: 0 }}>
            {theme === 'light' ? <FaMoon size={16} /> : <FaSun size={16} />}
          </span>
          <span className={styles.sidebarLabel}>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
        </button>
      </div>
    </div>
  );
}
