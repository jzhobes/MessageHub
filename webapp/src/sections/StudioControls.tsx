import React, { useState } from 'react';
import { FaCaretDown } from 'react-icons/fa';
import { Thread } from '@/lib/shared/types';
import { PlatformMap } from '@/lib/shared/platforms';
import styles from '@/pages/studio.module.css';
import { Dropdown, DropdownItem, DropdownDivider } from '@/components/Dropdown';

interface StudioControlsProps {
  visibleThreads: Thread[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  filterPlatforms: Set<string>;
  onFilterChange: (filters: Set<string>) => void;
}

export function StudioControls({
  visibleThreads,
  selectedIds,
  onChange,
  filterPlatforms,
  onFilterChange,
}: StudioControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

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
    setMenuOpen(false);
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
      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={
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
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                className={styles.checkbox}
                style={{ margin: 0, marginRight: 8, cursor: 'pointer' }}
                checked={visibleThreads.length > 0 && visibleThreads.every((t) => selectedIds.has(t.id))}
                ref={(el) => {
                  const count = visibleThreads.filter((t) => selectedIds.has(t.id)).length;
                  if (el) {
                    el.indeterminate = count > 0 && count < visibleThreads.length;
                  }
                }}
                onChange={() => {
                  handleMasterToggle();
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <div
                style={{
                  display: 'flex',
                  paddingLeft: 4,
                  borderLeft: '1px solid var(--border-color)',
                  height: 14,
                  alignItems: 'center',
                }}
              >
                <FaCaretDown size={12} color="var(--text-secondary)" />
              </div>
            </div>
          }
        >
          <DropdownItem
            onClick={() => {
              handleMasterToggle();
              setMenuOpen(false);
            }}
          >
            {visibleThreads.length > 0 && visibleThreads.every((t) => selectedIds.has(t.id))
              ? 'Select None'
              : 'Select All'}
          </DropdownItem>
          <DropdownDivider />
          {[50, 25, 10].map((n) => (
            <DropdownItem key={n} onClick={() => selectTop(n)}>
              Top {n}
            </DropdownItem>
          ))}
        </Dropdown>

        <div style={{ marginRight: 12 }}>
          <Dropdown
            width={220}
            open={filterOpen}
            onOpenChange={setFilterOpen}
            trigger={
              <button
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
            }
          >
            <DropdownItem onClick={() => onFilterChange(new Set())}>
              <input
                type="checkbox"
                checked={filterPlatforms.size === 0}
                readOnly
                style={{ marginRight: 8, pointerEvents: 'none' }}
              />
              All
            </DropdownItem>
            <DropdownDivider />
            {Object.values(PlatformMap).map((label) => (
              <DropdownItem key={label} onClick={() => toggleFilter(label)}>
                <input
                  type="checkbox"
                  checked={filterPlatforms.has(label)}
                  readOnly
                  style={{ marginRight: 8, pointerEvents: 'none' }}
                />
                {label}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>

        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {selectedIds.size} selected
        </span>
      </div>
    </div>
  );
}
