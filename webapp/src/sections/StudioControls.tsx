import React, { useState } from 'react';

import { FaBroom, FaCaretDown, FaMagic, FaSpinner } from 'react-icons/fa';

import { Dropdown, DropdownItem } from '@/components/Dropdown';
import PlatformSelectionDropdown from '@/components/PlatformSelectionDropdown';

import { Thread } from '@/lib/shared/types';
import styles from '@/pages/studio.module.css';

interface StudioControlsProps {
  visibleThreads: Thread[];
  selectedIds: Set<string>;
  filterPlatforms: Set<string>;
  filterTypes: Set<string>;
  activePersonas: Set<string>;
  scanningLabels: Set<string>;
  excludeNoise: boolean;
  minQuality: number;
  analyzing?: boolean;
  platformCounts?: Record<string, number>;
  personaCounts?: Record<string, number>;
  onSelectionChange: (ids: Set<string>) => void;
  onFilterChange: (filters: Set<string>) => void;
  onTogglePersona: (label: string) => void;
  onControlChange: (
    key: 'excludeNoise' | 'minQuality' | 'filterPlatforms' | 'filterTypes',
    value: boolean | number | Set<string>,
  ) => void;
}

export function StudioControls({
  visibleThreads,
  selectedIds,
  filterPlatforms,
  filterTypes,
  activePersonas,
  scanningLabels,
  excludeNoise,
  minQuality,
  analyzing,
  platformCounts,
  personaCounts,
  onSelectionChange,
  onFilterChange,
  onTogglePersona,
  onControlChange,
}: StudioControlsProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [smartOpen, setSmartOpen] = useState(false);
  const visibleSelectedCount = visibleThreads.reduce((acc, t) => acc + (selectedIds.has(t.id) ? 1 : 0), 0);

  const handleMasterToggle = () => {
    const visibleIds = visibleThreads.map((t) => t.id);
    const anySelected = visibleIds.some((id) => selectedIds.has(id));

    if (anySelected) {
      // Uncheck all visible
      const next = new Set(selectedIds);
      visibleIds.forEach((id) => next.delete(id));
      onSelectionChange(next);
    } else {
      // Check all visible
      const next = new Set(selectedIds);
      visibleIds.forEach((id) => next.add(id));
      onSelectionChange(next);
    }
  };

  const handlePlatformChange = (platforms: Set<string>, categories: Set<string>) => {
    onFilterChange(platforms);
    onControlChange('filterTypes', categories);
  };

  return (
    <div className={styles.paneControls} style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: 48 }}>
        <div style={{ flex: 1.2 }}>
          <Dropdown
            menuClassName={styles.platformDropdownMenu}
            open={smartOpen}
            trigger={
              <button
                className={styles.platformDropdown}
                title="Select threads"
                style={{ width: '100%', justifyContent: 'space-between', paddingLeft: '24px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                  <div style={{ width: 1, height: 16, background: 'var(--border-color)', transform: 'scaleX(0.5)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FaMagic size={14} color={analyzing ? 'var(--bubble-sent-bg)' : 'currentColor'} />
                    <span style={{ whiteSpace: 'nowrap', color: analyzing ? 'var(--bubble-sent-bg)' : 'inherit' }}>
                      {analyzing ? 'Scanning...' : 'Personas'}
                    </span>
                  </div>
                </div>
                <FaCaretDown size={12} />
              </button>
            }
            width="auto"
            minWidth="trigger"
            onOpenChange={setSmartOpen}
          >
            {[
              'Formal',
              'Casual',
              'Social',
              'Active',
              'Sarcastic',
              'Humorous',
              'Serious',
              'Professional',
              'Technical',
              'Empathetic',
              'Assertive',
            ].map((style) => (
              <DropdownItem key={style} onClick={() => onTogglePersona(style)}>
                <input type="checkbox" checked={activePersonas.has(style)} style={{ marginRight: 8 }} readOnly />
                <span style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  {style}
                  {scanningLabels.has(style) && (
                    <FaSpinner
                      size={12}
                      color="var(--text-secondary)"
                      style={{
                        animation: 'spin 1s linear infinite',
                        marginLeft: 8,
                      }}
                    />
                  )}
                </span>
                {personaCounts && (personaCounts[style] || 0) > 0 && (
                  <span
                    style={{
                      fontSize: 'var(--studio-header-font-size)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    ({(personaCounts[style] || 0).toLocaleString()})
                  </span>
                )}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>

        <div style={{ flex: 1.2 }}>
          <PlatformSelectionDropdown
            open={filterOpen}
            selectedPlatforms={filterPlatforms}
            selectedCategories={filterTypes}
            counts={platformCounts ? { platforms: platformCounts, categories: platformCounts } : undefined}
            width="auto"
            trigger={
              <button className={styles.platformDropdown} style={{ width: '100%', justifyContent: 'space-between' }}>
                <span>Platforms</span>
                <FaCaretDown size={12} />
              </button>
            }
            onOpenChange={setFilterOpen}
            onChange={handlePlatformChange}
          />
        </div>
      </div>
      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
          height: 44,
        }}
      >
        <span className={styles.resultsCount} style={{ paddingLeft: 16 }}>
          {visibleSelectedCount.toLocaleString()}
          &nbsp;/&nbsp;
          {visibleThreads.length.toLocaleString()} threads selected
        </span>

        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <button
            className={styles.controlDropdown}
            style={{
              height: '100%',
              padding: '0 8px',
              gap: 8,
              border: 'none',
              borderLeft: '1px solid var(--border-color)',
              borderRadius: 0,
            }}
            title="Exclude automated messages and idle threads"
            onClick={() => onControlChange('excludeNoise', !excludeNoise)}
          >
            <FaBroom
              size={16}
              color={excludeNoise ? 'var(--bubble-sent-bg)' : 'var(--text-secondary)'}
              style={{ transition: 'color 0.2s' }}
            />
            <span
              style={{
                fontSize: 'var(--studio-header-font-size)',
                fontWeight: 500,
                color: excludeNoise ? 'var(--bubble-sent-bg)' : 'inherit',
              }}
            >
              Clean
            </span>
          </button>

          <div
            className={styles.controlDropdown}
            style={{
              height: '100%',
              padding: '0 8px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'default',
              width: 'auto',
              borderLeft: '1px solid var(--border-color)',
              borderRadius: 0,
            }}
            title="Filter by Minimum Quality Score"
          >
            <label
              htmlFor="minQuality"
              style={{
                fontSize: 'var(--studio-header-font-size)',
                fontWeight: 400,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              Quality
            </label>
            <input
              id="minQuality"
              type="number"
              min={0}
              max={100}
              step={10}
              value={minQuality || 0}
              style={{
                height: '100%',
                width: '45px',
                border: 'none',
                background: 'transparent',
                textAlign: 'right',
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                outline: 'none',
              }}
              onChange={(e) => onControlChange('minQuality', parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
