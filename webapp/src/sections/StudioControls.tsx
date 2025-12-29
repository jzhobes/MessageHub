import React, { useState } from 'react';

import { FaCaretDown } from 'react-icons/fa';

import { Dropdown, DropdownDivider, DropdownItem } from '@/components/Dropdown';

import { PlatformMap } from '@/lib/shared/platforms';
import { Thread } from '@/lib/shared/types';
import styles from '@/pages/studio.module.css';

interface StudioControlsProps {
  visibleThreads: Thread[];
  selectedIds: Set<string>;
  filterPlatforms: Set<string>;
  onChange: (ids: Set<string>) => void;
  onFilterChange: (filters: Set<string>) => void;
}

export function StudioControls({
  visibleThreads,
  selectedIds,
  filterPlatforms,
  onChange,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', width: '100%' }}>
        <Dropdown
          open={menuOpen}
          trigger={
            <button className={styles.checkboxDropdown}>
              <input
                ref={(el) => {
                  const count = visibleThreads.filter((t) => selectedIds.has(t.id)).length;
                  if (el) {
                    el.indeterminate = count > 0 && count < visibleThreads.length;
                  }
                }}
                type="checkbox"
                className={styles.checkbox}
                style={{ margin: 0, cursor: 'pointer' }}
                checked={visibleThreads.length > 0 && visibleThreads.every((t) => selectedIds.has(t.id))}
                onChange={() => {
                  handleMasterToggle();
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <div className={styles.caretWrapper}>
                <FaCaretDown size={12} color="var(--text-secondary)" />
              </div>
            </button>
          }
          onOpenChange={setMenuOpen}
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
            trigger={
              <button className={styles.platformDropdown}>
                <span>Platforms</span>
                <FaCaretDown size={12} />
              </button>
            }
            onOpenChange={setFilterOpen}
          >
            <DropdownItem onClick={() => onFilterChange(new Set())}>
              <input type="checkbox" checked={filterPlatforms.size === 0} style={{ marginRight: 8 }} readOnly />
              All
            </DropdownItem>
            <DropdownDivider />
            {Object.values(PlatformMap).map((label) => (
              <DropdownItem key={label} onClick={() => toggleFilter(label)}>
                <input type="checkbox" checked={filterPlatforms.has(label)} style={{ marginRight: 8 }} readOnly />
                {label}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>

        <span className={styles.resultsCount}>{selectedIds.size.toLocaleString()} selected</span>
      </div>
    </div>
  );
}
