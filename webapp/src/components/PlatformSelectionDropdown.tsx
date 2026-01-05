import React from 'react';

import { Dropdown, DropdownDivider, DropdownItem } from '@/components/Dropdown';

import styles from './PlatformSelectionDropdown.module.css';

export interface PlatformOption {
  id: string;
  label: string;
  categories?: { id: string; label: string }[];
}

export const PLATFORM_HIERARCHY: PlatformOption[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    categories: [
      { id: 'message', label: 'Messages' },
      { id: 'post', label: 'Posts' },
      { id: 'event', label: 'Events' },
    ],
  },
  { id: 'instagram', label: 'Instagram' },
  { id: 'google_chat', label: 'Google Chat' },
  { id: 'google_voice', label: 'Google Voice' },
  { id: 'google_mail', label: 'Gmail' },
];

interface PlatformSelectionDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPlatforms: Set<string>;
  selectedCategories: Set<string>;
  counts?: {
    platforms: Record<string, number>;
    categories: Record<string, number>;
  };
  onChange: (platforms: Set<string>, categories: Set<string>) => void;
  trigger: React.ReactNode;
  width?: number | string;
  align?: 'left' | 'right';
}

export default function PlatformSelectionDropdown({
  open,
  onOpenChange,
  selectedPlatforms,
  selectedCategories,
  counts,
  onChange,
  trigger,
  width = 240,
  align = 'left',
}: PlatformSelectionDropdownProps) {
  const totalCount = counts?.platforms?.['All'] ?? Object.values(counts?.platforms ?? {}).reduce((a, b) => a + b, 0);

  const handleTogglePlatform = (platformId: string) => {
    const nextPlatforms = new Set(selectedPlatforms);
    const nextCategories = new Set(selectedCategories);

    const option = PLATFORM_HIERARCHY.find((p) => p.id === platformId);

    if (nextPlatforms.has(platformId)) {
      // Deactivate platform and all its categories
      nextPlatforms.delete(platformId);
      option?.categories?.forEach((cat) => nextCategories.delete(cat.id));
    } else {
      // Activate platform and all its categories
      nextPlatforms.add(platformId);
      option?.categories?.forEach((cat) => nextCategories.add(cat.id));
    }

    onChange(nextPlatforms, nextCategories);
  };

  const handleToggleCategory = (platformId: string, categoryId: string) => {
    const nextPlatforms = new Set(selectedPlatforms);
    const nextCategories = new Set(selectedCategories);

    if (nextCategories.has(categoryId)) {
      nextCategories.delete(categoryId);

      // If no categories left for this platform, should we uncheck platform?
      // In hierarchy mode, if any category is off, the platform is Indeterminate
      // We keep the platform ID in the set if it's partially checked
    } else {
      nextCategories.add(categoryId);
      // Ensure platform is in current set if a child is checked
      nextPlatforms.add(platformId);
    }

    onChange(nextPlatforms, nextCategories);
  };

  const handleReset = () => {
    onChange(new Set(), new Set());
  };

  return (
    <Dropdown open={open} trigger={trigger} width={width} align={align} onOpenChange={onOpenChange}>
      <DropdownItem onClick={handleReset}>
        <input
          type="checkbox"
          checked={selectedPlatforms.size === 0 && selectedCategories.size === 0}
          className={styles.dropdownCheckbox}
          readOnly
        />
        <span className={styles.label}>All Platforms</span>
        {totalCount > 0 && <span className={styles.count}>({totalCount.toLocaleString()})</span>}
      </DropdownItem>

      <DropdownDivider />

      {PLATFORM_HIERARCHY.map((platform) => {
        const isSelected = selectedPlatforms.has(platform.id);
        const platformCount = counts?.platforms?.[platform.id] ?? 0;

        // Indeterminate state logic
        const hasCategories = !!platform.categories?.length;
        const selectedCatCount = platform.categories?.filter((c) => selectedCategories.has(c.id)).length ?? 0;
        const isAllCatsChecked = hasCategories && selectedCatCount === platform.categories!.length;
        const isIndeterminate = hasCategories && isSelected && selectedCatCount > 0 && !isAllCatsChecked;

        return (
          <React.Fragment key={platform.id}>
            <DropdownItem onClick={() => handleTogglePlatform(platform.id)}>
              <input
                ref={(el) => {
                  if (el) {
                    el.indeterminate = isIndeterminate;
                  }
                }}
                type="checkbox"
                checked={isSelected && (!hasCategories || isAllCatsChecked)}
                className={styles.dropdownCheckbox}
                readOnly
              />
              <span className={styles.label}>{platform.label}</span>
              {platformCount > 0 && <span className={styles.count}>({platformCount.toLocaleString()})</span>}
            </DropdownItem>

            {platform.categories?.map((cat) => {
              const catCount = counts?.categories?.[cat.id] ?? 0;
              // For FB messages specifically, we sometimes have it as facebook:message in counts
              const displayCount = catCount || (counts?.categories?.[`${platform.id}:${cat.id}`] ?? 0);

              return (
                <DropdownItem
                  key={cat.id}
                  className={styles.subItem}
                  onClick={() => handleToggleCategory(platform.id, cat.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(cat.id)}
                    className={styles.dropdownCheckbox}
                    readOnly
                  />
                  <span className={styles.label}>{cat.label}</span>
                  {displayCount > 0 && <span className={styles.count}>({displayCount.toLocaleString()})</span>}
                </DropdownItem>
              );
            })}
          </React.Fragment>
        );
      })}
    </Dropdown>
  );
}
