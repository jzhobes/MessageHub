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

interface FileExplorerProps {
  onSelectionChange: (paths: string[]) => void;
  initialPath?: string;
  height?: number | string;
  actionPanel?: React.ReactNode;
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

export default function FileExplorer({ onSelectionChange, initialPath, height = 300, actionPanel }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const selectableFiles = useMemo(() => items.filter((i) => i.type === 'file'), [items]);

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
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      // Reset selection state on path change
      if (active) {
        // Optionally, we might want to clear selection or keep it?
        // Current behavior: FileExplorer usually clears selection on navigate away?
        // Wait, state `selectedPaths` persists but `items` change.
        // If `currentPath` changes, `selectedPaths` usually should be cleared or filtered?
        // In typical file managers, navigating away clears selection of that folder.
        // Let's assume we maintain selection as is for now unless user clears it.
        // BUT `rangeSelection` history relies on indices of `items`.
        // If `items` changes, history MUST be reset.
      }

      try {
        const params = new URLSearchParams();
        if (currentPath) {
          params.set('path', currentPath);
        }

        const res = await fetch(`/api/system/list?${params.toString()}`);
        if (!res.ok) {
          if (active) {
            setItems([]);
          }
          const err = await res.json();
          throw new Error(err.error ?? 'Failed to list');
        }

        const data = await res.json();
        if (active) {
          if (!currentPath) {
            setCurrentPath(data.path);
          }
          setParentPath(data.parent);
          setItems(data.items);
          // Reset range history when items change
          resetSelectionHistory();
          // Optionally clear selection if navigating to new folder?
          // For now, let's clear selection to avoid confusion with new items
          setSelectedPaths(new Set());
          setSelectedSizes({});
          onSelectionChange([]);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [currentPath, resetSelectionHistory, onSelectionChange]); // Added deps

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
        <button
          onClick={handleToggleAll}
          style={{
            background: 'none',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            color: 'var(--text-primary)',
            padding: 0,
            opacity: selectableFiles.length === 0 ? 0.5 : 1,
            pointerEvents: selectableFiles.length === 0 ? 'none' : 'auto',
          }}
        >
          {allSelected ? (
            <FaCheckSquare color="#2563eb" size={16} />
          ) : indeterminate ? (
            // Indeterminate state visual
            <div
              style={{
                width: 14,
                height: 14,
                border: '2px solid #2563eb', // Blue border
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#2563eb', // Blue fill
              }}
            >
              {/* White horizontal line */}
              <div style={{ width: 8, height: 2, background: 'white' }} />
            </div>
          ) : (
            <FaSquare color="#d1d5db" size={16} />
          )}
          <span style={{ fontWeight: 500 }}>Select All</span>
        </button>

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
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <FaFolderOpen size={24} />
            &nbsp;Empty folder
          </div>
        ) : (
          items.map((item) => {
            const isSelected = selectedPaths.has(item.path);

            return (
              <div
                key={item.path}
                className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
                onClick={() => {
                  if (item.type === 'folder') {
                    handleNavigate(item.path);
                  } else {
                    handleToggle(item);
                  }
                }}
              >
                {/* Checkbox for files */}
                {item.type === 'file' ? (
                  <div
                    className={styles.checkbox}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(item);
                    }}
                  >
                    {isSelected ? <FaCheckSquare color="#2563eb" size={16} /> : <FaSquare color="#d1d5db" size={16} />}
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
                  <div
                    style={{
                      fontSize: '0.85em',
                      color: 'var(--text-secondary)',
                      marginLeft: 8,
                      minWidth: 60,
                      textAlign: 'right',
                    }}
                  >
                    {formatBytes(item.size)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '0.85em',
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
        }}
      >
        <span>{items.length} items</span>
        <span>
          {selectedPaths.size} selected
          {selectedPaths.size > 0 && ` (${formatBytes(totalSelectedSize)})`}
        </span>
      </div>
    </div>
  );
}
