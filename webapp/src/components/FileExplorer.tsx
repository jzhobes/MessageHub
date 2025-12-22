import React, { useRef, useState, useEffect, useMemo } from 'react';
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
import { useRangeSelection } from '@/hooks/useRangeSelection';
import { PathMetadata } from '@/lib/shared/types';
import styles from './FileExplorer.module.css';

export type { PathMetadata };

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
  initialPath?: string;
  height?: number | string;
  subheader?: React.ReactNode;
  addressBarSuffix?: React.ReactNode;
  footer?: React.ReactNode | ((data: FileExplorerFooterData) => React.ReactNode);
  mode?: 'import' | 'workspace';
  filters?: FileFilterRule[];
  allowSelectAll?: boolean;
  onError?: (error: { message: string; status?: number } | null) => void;
  onMetadataChange?: (metadata: PathMetadata) => void;
  onPathChange?: (path: string) => void;
  onSelectionChange?: (paths: string[], totalSize: number) => void;
}

export interface FileExplorerFooterData {
  selectedCount: number;
  totalSize: number;
  visibleCount: number;
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

export function formatBytes(bytes: number, decimals = 1) {
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
  initialPath,
  height = 300,
  subheader,
  addressBarSuffix,
  footer,
  mode = 'import',
  filters = [],
  allowSelectAll = true,
  onError,
  onMetadataChange,
  onPathChange,
  onSelectionChange,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [debouncedPath, setDebouncedPath] = useState(currentPath);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<PathMetadata | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Record<string, number>>({});
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const onPathChangeRef = useRef(onPathChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onErrorRef = useRef(onError);
  const onMetadataChangeRef = useRef(onMetadataChange);

  useEffect(() => {
    onPathChangeRef.current = onPathChange;
    onSelectionChangeRef.current = onSelectionChange;
    onErrorRef.current = onError;
    onMetadataChangeRef.current = onMetadataChange;
  }, [onPathChange, onSelectionChange, onError, onMetadataChange]);

  // Debounce path changes for API calls (ONLY if not immediate)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedPath(currentPath);
    }, 300);

    return () => clearTimeout(handler);
  }, [currentPath]);

  const navigateTo = (newPath: string, immediate = false) => {
    if (immediate) {
      // Bypassing debounce for explicit clicks/actions
      setDebouncedPath(newPath);
    }
    setCurrentPath(newPath);
  };

  // Sync initialPath if changed from outside
  useEffect(() => {
    if (initialPath !== undefined && initialPath !== currentPath) {
      navigateTo(initialPath, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  // Notify parent of path changes (Debounced to prevent rendering loops)
  useEffect(() => {
    onPathChangeRef.current?.(debouncedPath);
  }, [debouncedPath]);

  useEffect(() => {
    onErrorRef.current?.(error);
  }, [error]);

  // Apply filters
  const visibleItems = useMemo(() => {
    if (!filters || filters.length === 0) {
      return items;
    }

    return items.filter((item) => {
      if (item.type === 'folder') {
        return true;
      }

      let isVisible = true;

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
    return visibleItems.filter((i: FileItem) => {
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
  }, [visibleItems, filters]);

  const { handleSelection, resetSelectionHistory } = useRangeSelection({
    items: selectableFiles,
    selectedIds: selectedPaths,
    onChange: (ids) => {
      setSelectedPaths(ids);
      // Re-calculate sizes based on new selection
      const newSizes: Record<string, number> = {};
      let total = 0;
      selectableFiles.forEach((item: FileItem) => {
        if (ids.has(item.path)) {
          const s = item.size ?? 0;
          newSizes[item.path] = s;
          total += s;
        }
      });
      setSelectedSizes(newSizes);
      onSelectionChangeRef.current?.(Array.from(ids), total);
    },
    getId: (item: FileItem) => item.path,
  });

  // Fetch directory
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (debouncedPath) {
          params.set('path', debouncedPath);
        }
        params.set('mode', mode);

        const res = await fetch(`/api/system/list?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          setItems([]);
          const err = await res.json();
          setError({ message: err.error ?? 'Failed to list', status: res.status });
          return;
        }

        const data = await res.json();
        if (!debouncedPath) {
          setCurrentPath(data.path);
          setDebouncedPath(data.path);
        }
        setParentPath(data.parent);
        setItems(data.items);
        setMetadata(data.meta);
        onMetadataChangeRef.current?.(data.meta);

        resetSelectionHistory();
        setSelectedPaths(new Set());
        setSelectedSizes({});
        onSelectionChangeRef.current?.([], 0);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          // Ignore abort errors
          return;
        }
        setError({ message: e instanceof Error ? e.message : String(e) });
        // Clear metadata on true error
        const meta = {
          exists: false,
          isWritable: false,
          isEmpty: true,
          isNested: false,
          isActive: false,
          isExistingWorkspace: false,
        };
        setMetadata(meta);
        onMetadataChangeRef.current?.(meta);
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
  }, [debouncedPath, resetSelectionHistory, mode]);

  const handleToggle = (item: FileItem) => {
    if (item.type === 'file') {
      handleSelection(item.path);
    }
  };

  const handleToggleAll = () => {
    // If ANY are selected, uncheck all. Else check all.
    const anySelected = selectableFiles.some((f: FileItem) => selectedPaths.has(f.path));

    // Use handleSelection logic? No, global toggle is custom.
    const next = new Set(selectedPaths);

    if (anySelected) {
      // Uncheck all visible
      selectableFiles.forEach((f: FileItem) => next.delete(f.path));
    } else {
      // Check all visible
      selectableFiles.forEach((f: FileItem) => next.add(f.path));
    }

    // Update logic same as hook callback
    setSelectedPaths(next);
    const newSizes: Record<string, number> = {};
    let total = 0;
    selectableFiles.forEach((item: FileItem) => {
      if (next.has(item.path)) {
        const s = item.size ?? 0;
        newSizes[item.path] = s;
        total += s;
      }
    });
    setSelectedSizes(newSizes);
    onSelectionChangeRef.current?.(Array.from(next), total);

    resetSelectionHistory();
  };

  const handleNavigate = (path: string) => {
    navigateTo(path, true);
  };

  const handleUp = () => {
    if (parentPath) {
      navigateTo(parentPath, true);
    }
  };

  const totalSelectedSize = Object.values(selectedSizes).reduce((a, b) => a + b, 0);

  const allSelected = selectableFiles.length > 0 && selectableFiles.every((f: FileItem) => selectedPaths.has(f.path));
  const someSelected = selectableFiles.some((f: FileItem) => selectedPaths.has(f.path));
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
              navigateTo(currentPath, true);
            }
          }}
          adornment={
            <>
              <button className={styles.navButton} onClick={() => navigateTo('', true)} title="Go Home">
                <FaHome size={16} />
              </button>
              <button className={styles.navButton} onClick={handleUp} disabled={!parentPath} title="Go Up">
                <FaArrowUp size={16} />
              </button>
            </>
          }
          suffix={addressBarSuffix}
        />
      </div>
      {/* Subheader / Actions */}
      {(allowSelectAll || subheader) && (
        <div className={styles.headerActions}>
          {allowSelectAll && (
            <button
              onClick={handleToggleAll}
              className={`${styles.selectAllButton} ${
                visibleItems.some((i: FileItem) => i.type === 'file') && selectableFiles.length === 0
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

          {/* External Subheader Slot */}
          <div className={styles.subheaderSlot}>{subheader}</div>
        </div>
      )}
      {/* Content */}
      <div className={styles.list}>
        {loading ? (
          <div className={styles.loading}>
            <FaSpinner className="spinner" />
            <span style={{ marginLeft: 8 }}>Loading...</span>
          </div>
        ) : error ? (
          <div className={styles.empty} style={{ color: '#ef4444' }}>
            {error.message}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className={styles.empty}>
            {mode === 'workspace' && !metadata?.exists ? (
              <FaFolderOpen size={62} opacity={0.5} />
            ) : (
              <>
                <FaFolderOpen size={24} />
                &nbsp;Empty folder
              </>
            )}
          </div>
        ) : (
          visibleItems.map((item: FileItem) => {
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
        {typeof footer === 'function' ? (
          footer({
            selectedCount: selectedPaths.size,
            totalSize: totalSelectedSize,
            visibleCount: visibleItems.length,
          })
        ) : footer ? (
          footer
        ) : (
          <>
            <span>{visibleItems.length} items</span>
            {selectedPaths.size > 0 && (
              <span>
                {selectedPaths.size} selected ({formatBytes(totalSelectedSize)})
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
