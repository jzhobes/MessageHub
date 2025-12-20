import React, { useState, useEffect, useMemo } from 'react';
import {
  FaFolder,
  FaFileArchive,
  FaFile,
  FaArrowUp,
  FaSpinner,
  FaCheckSquare,
  FaSquare,
  FaHome,
  FaFolderOpen,
} from 'react-icons/fa';

import TextInput from './TextInput';
import styles from './FileExplorer.module.css';
import { useRangeSelection } from '@/hooks/useRangeSelection';

interface FileItem {
  name: string;
  path: string;
  type: 'folder' | 'file';
  size?: number;
}

interface FileFilterRule {
  pattern: string;
  visible?: boolean;
  selectable?: boolean;
}

interface FileExplorerProps {
  onSelectionChange: (paths: string[]) => void;
  initialPath?: string;
  height?: number | string;
  actionPanel?: React.ReactNode;
  mode?: 'import' | 'workspace';
  filters?: FileFilterRule[];
  allowSelectAll?: boolean;
}

function simpleGlobMatch(filename: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1); // e.g., ".zip"
    return filename.toLowerCase().endsWith(ext.toLowerCase());
  }
  return filename === pattern;
}

function formatBytes(bytes: number, decimals = 1) {
  if (!+bytes) {
    return '0 B';
  }
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function FileExplorer({
  onSelectionChange,
  initialPath,
  height = 300,
  actionPanel,
  mode = 'import',
  filters = [],
  allowSelectAll = true,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Apply filters
  const processedItems = useMemo(() => {
    if (!filters || filters.length === 0) {
      return items;
    }

    return items.filter((item) => {
      // Folders always visible? Let's assume yes for navigation
      if (item.type === 'folder') {
        return true;
      }

      let isVisible = true; // Default visible if no filters, but here we have filters.
      // Usually "Deny All" or "Allow All" depends on the first rule or default.
      // Let's adopt consistent logic: Default TRUE unless a rule says FALSE?
      // Or Default match logic.
      // Let's iterate rules. Last match wins.
      // If no rules match, default is visible.

      for (const rule of filters) {
        if (simpleGlobMatch(item.name, rule.pattern)) {
          if (rule.visible !== undefined) {
            isVisible = rule.visible;
          }
        }
      }
      return isVisible;
    });
  }, [items, filters]);

  const selectableFiles = useMemo(() => {
    return processedItems.filter((i) => {
      if (i.type !== 'file') {
        return false;
      }

      let isSelectable = true;
      if (filters && filters.length > 0) {
        for (const rule of filters) {
          if (simpleGlobMatch(i.name, rule.pattern)) {
            if (rule.selectable !== undefined) {
              isSelectable = rule.selectable;
            }
          }
        }
      }
      return isSelectable;
    });
  }, [processedItems, filters]);

  const { handleSelection, resetSelectionHistory } = useRangeSelection({
    items: selectableFiles,
    selectedIds: selectedPaths,
    onChange: (ids) => {
      setSelectedPaths(ids);
      // Re-calculate sizes based on new selection
      const newSizes: Record<string, number> = {};
      selectableFiles.forEach((item) => {
        if (ids.has(item.path)) {
          newSizes[item.path] = item.size ?? 0;
        }
      });
      setSelectedSizes(newSizes);
      onSelectionChange(Array.from(ids));
    },
    getId: (item) => item.path,
  });

  // Fetch directory
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (currentPath) {
          params.set('path', currentPath);
        }
        params.set('mode', mode);

        const res = await fetch(`/api/system/list?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          setItems([]);
          const err = await res.json();
          throw new Error(err.error ?? 'Failed to list');
        }

        const data = await res.json();
        if (!currentPath) {
          setCurrentPath(data.path);
        }
        setParentPath(data.parent);
        setItems(data.items);
        resetSelectionHistory();
        setSelectedPaths(new Set());
        setSelectedSizes({});
        onSelectionChange([]);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Ignore abort errors
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      controller.abort();
    };
  }, [currentPath, resetSelectionHistory, onSelectionChange, mode]);

  const handleToggle = (item: FileItem) => {
    if (item.type === 'file') {
      handleSelection(item.path);
    }
  };

  const handleToggleAll = () => {
    // If ANY are selected, uncheck all. Else check all.
    const anySelected = selectableFiles.some((f) => selectedPaths.has(f.path));

    // Use handleSelection logic? No, global toggle is custom.
    const next = new Set(selectedPaths);

    if (anySelected) {
      // Uncheck all visible
      selectableFiles.forEach((f) => next.delete(f.path));
    } else {
      // Check all visible
      selectableFiles.forEach((f) => next.add(f.path));
    }

    // Update logic same as hook callback
    setSelectedPaths(next);
    const newSizes: Record<string, number> = {};
    selectableFiles.forEach((item) => {
      if (next.has(item.path)) {
        newSizes[item.path] = item.size ?? 0;
      } else {
        // Keep existing sizes of items NOT in this folder?
        // The logic: `selectedPaths` is `Set<string>`.
        // Wait, if we navigate, we clear `selectedPaths` above.
        // So `selectedPaths` only contains items in CURRENT folder.
      }
    });
    setSelectedSizes(newSizes);
    onSelectionChange(Array.from(next));

    resetSelectionHistory();
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  const handleUp = () => {
    if (parentPath) {
      setCurrentPath(parentPath);
    }
  };

  const totalSelectedSize = Object.values(selectedSizes).reduce((a, b) => a + b, 0);

  const allSelected = selectableFiles.length > 0 && selectableFiles.every((f) => selectedPaths.has(f.path));
  const someSelected = selectableFiles.some((f) => selectedPaths.has(f.path));
  const indeterminate = someSelected && !allSelected;

  return (
    <div className={styles.container} style={{ height }}>
      {/* Header / Address Bar */}
      <div className={styles.header}>
        <TextInput
          autoFocus
          className={styles.addressBar}
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
            }
          }}
          adornment={
            <>
              <button className={styles.navButton} onClick={() => setCurrentPath('')} title="Go Home">
                <FaHome size={16} />
              </button>
              <button className={styles.navButton} onClick={handleUp} disabled={!parentPath} title="Go Up">
                <FaArrowUp size={16} />
              </button>
            </>
          }
        />
      </div>

      {/* Subheader / Actions */}
      <div className={styles.headerActions}>
        {allowSelectAll && (
          <button
            onClick={handleToggleAll}
            className={`${styles.selectAllButton} ${
              processedItems.some((i) => i.type === 'file') && selectableFiles.length === 0
                ? styles.selectAllHidden
                : selectableFiles.length === 0
                  ? styles.selectAllDisabled
                  : styles.selectAllVisible
            }`}
          >
            {allSelected ? (
              <FaCheckSquare color="var(--border-thread-active)" size={16} />
            ) : indeterminate ? (
              // Indeterminate state visual
              <div
                className={styles.indeterminateBox}
                style={{ borderColor: 'var(--border-thread-active)', background: 'var(--border-thread-active)' }}
              >
                {/* White horizontal line */}
                <div className={styles.indeterminateLine} />
              </div>
            ) : (
              <FaSquare color="#d1d5db" size={16} />
            )}
            <span style={{ fontWeight: 500 }}>Select All</span>
          </button>
        )}

        {/* External Actions (Copy/Move) */}
        <div>{actionPanel}</div>
      </div>

      {/* Content */}
      <div className={styles.list}>
        {loading ? (
          <div className={styles.loading}>
            <FaSpinner className="spinner" />
            <span style={{ marginLeft: 8 }}>Loading...</span>
          </div>
        ) : error ? (
          <div className={styles.empty} style={{ color: '#ef4444' }}>
            {error}
          </div>
        ) : processedItems.length === 0 ? (
          <div className={styles.empty}>
            <FaFolderOpen size={24} />
            &nbsp;Empty folder
          </div>
        ) : (
          processedItems.map((item) => {
            const isSelected = selectedPaths.has(item.path);

            // Determine selectability for specific item
            let isSelectable = true;
            if (item.type === 'file' && filters.length > 0) {
              for (const rule of filters) {
                if (simpleGlobMatch(item.name, rule.pattern)) {
                  if (rule.selectable !== undefined) {
                    isSelectable = rule.selectable;
                  }
                }
              }
            }
            if (item.type === 'folder') {
              isSelectable = false;
            } // Folders not selectable in this logic

            return (
              <div
                key={item.path}
                className={`${styles.item} ${isSelected ? styles.itemSelected : ''} ${!isSelectable && item.type === 'file' ? styles.itemDisabled : ''}`}
                onClick={() => {
                  if (item.type === 'folder') {
                    handleNavigate(item.path);
                  } else if (isSelectable) {
                    handleToggle(item);
                  }
                }}
              >
                {/* Checkbox for files */}
                {item.type === 'file' ? (
                  <div
                    className={`${styles.checkbox} ${!isSelectable ? styles.checkboxHidden : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSelectable) {
                        handleToggle(item);
                      }
                    }}
                  >
                    {isSelected ? (
                      <FaCheckSquare color="var(--border-thread-active)" size={16} />
                    ) : (
                      <FaSquare color="#d1d5db" size={16} />
                    )}
                  </div>
                ) : (
                  <div style={{ width: 14 }}></div> // Spacer for folder
                )}

                {/* Icon */}
                <div className={item.type === 'folder' ? styles.icon : styles.fileIcon}>
                  {item.type === 'folder' ? (
                    <FaFolder />
                  ) : item.name.toLowerCase().endsWith('.zip') ? (
                    <FaFileArchive />
                  ) : (
                    <FaFile />
                  )}
                </div>

                {/* Name */}
                <div className={styles.name} title={item.name}>
                  {item.name}
                </div>

                {item.type === 'file' && item.size !== undefined && item.size > 0 && (
                  <div className={styles.fileSize}>{formatBytes(item.size)}</div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className={styles.footer}>
        <span>{processedItems.length} items</span>
        <span>
          {selectedPaths.size} selected
          {selectedPaths.size > 0 && ` (${formatBytes(totalSelectedSize)})`}
        </span>
      </div>
    </div>
  );
}
