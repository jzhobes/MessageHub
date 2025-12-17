import React, { useState } from 'react';
import { FaCaretDown } from 'react-icons/fa';
import { Thread } from '@/lib/shared/types';
import { PlatformMap } from '@/lib/shared/platforms';
import styles from '@/styles/Studio.module.css';

interface StudioControlsProps {
  visibleThreads: Thread[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  filterPlatforms: Set<string>;
  onFilterChange: (filters: Set<string>) => void;
}

export const StudioControls: React.FC<StudioControlsProps> = ({ visibleThreads, selectedIds, onChange, filterPlatforms, onFilterChange }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);

  const handleMasterToggle = () => {
    const visibleIds = visibleThreads.map((t) => t.id);
    const anySelected = visibleIds.some((id) => selectedIds.has(id));

    if (anySelected) {
      // Uncheck all visible
      const next = new Set(selectedIds);
      visibleIds.forEach((id) => next.delete(id));
      onChange(next);
    } else {
      // Check all visible
      const next = new Set(selectedIds);
      visibleIds.forEach((id) => next.add(id));
      onChange(next);
    }
  };

  const selectTop = (n: number) => {
    const ids = visibleThreads.slice(0, n).map((t) => t.id);
    onChange(new Set(ids));
    setDropdownOpen(false);
  };

  const toggleFilter = (label: string) => {
    const next = new Set(filterPlatforms);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    onFilterChange(next);
  };

  return (
    <div className={styles.paneControls}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            padding: '4px 8px',
            marginRight: 12,
            marginLeft: -9,
          }}
        >
          <input
            type="checkbox"
            className={styles.checkbox}
            style={{ margin: 0, marginRight: 8 }}
            checked={visibleThreads.length > 0 && visibleThreads.every((t) => selectedIds.has(t.id))}
            ref={(el) => {
              const count = visibleThreads.filter((t) => selectedIds.has(t.id)).length;
              if (el) {
                el.indeterminate = count > 0 && count < visibleThreads.length;
              }
            }}
            onChange={handleMasterToggle}
          />
          <div
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{ cursor: 'pointer', display: 'flex', paddingLeft: 4, borderLeft: '1px solid var(--border-color)', height: 14, alignItems: 'center' }}
          >
            <FaCaretDown size={12} color="var(--text-secondary)" />
          </div>

          {dropdownOpen && (
            <div className={styles.dropdownMenu}>
              <div
                className={styles.dropdownItem}
                onClick={() => {
                  handleMasterToggle();
                  setDropdownOpen(false);
                }}
              >
                {visibleThreads.length > 0 && visibleThreads.every((t) => selectedIds.has(t.id)) ? 'Select None' : 'Select All'}
              </div>
              <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
              {[50, 25, 10].map((n) => (
                <div key={n} className={styles.dropdownItem} onClick={() => selectTop(n)}>
                  Top {n}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'relative', marginRight: 12 }}>
          <button
            onClick={() => setPlatformDropdownOpen(!platformDropdownOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              padding: '4px 12px',
              borderRadius: 6,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            <span>Platforms</span>
            <FaCaretDown size={12} />
          </button>

          {platformDropdownOpen && (
            <div className={styles.dropdownMenu} style={{ width: 220 }}>
              <div className={styles.dropdownItem} onClick={() => onFilterChange(new Set())}>
                <input type="checkbox" checked={filterPlatforms.size === 0} readOnly style={{ marginRight: 8 }} />
                All
              </div>
              <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
              {Object.values(PlatformMap).map((label) => (
                <div key={label} className={styles.dropdownItem} onClick={() => toggleFilter(label)}>
                  <input type="checkbox" checked={filterPlatforms.has(label)} readOnly style={{ marginRight: 8 }} />
                  {label}
                </div>
              ))}
            </div>
          )}
          {platformDropdownOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setPlatformDropdownOpen(false)} />}
        </div>

        {dropdownOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setDropdownOpen(false)} />}

        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{selectedIds.size} selected</span>
      </div>
    </div>
  );
};
