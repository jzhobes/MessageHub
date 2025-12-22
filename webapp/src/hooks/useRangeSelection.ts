import { useRef, useEffect, useCallback } from 'react';

interface UseRangeSelectionProps<T> {
  items: T[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  getId: (item: T) => string;
}

export function useRangeSelection<T>({ items, selectedIds, onChange, getId }: UseRangeSelectionProps<T>) {
  const lastCheckedId = useRef<string | null>(null);
  const rangeStartId = useRef<string | null>(null);
  const rangeBase = useRef<Set<string>>(new Set());
  const shiftDown = useRef(false);

  // Track shift key state
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') {
        shiftDown.current = true;
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') {
        shiftDown.current = false;
        rangeStartId.current = null;
        rangeBase.current = new Set();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleSelection = useCallback(
    (id: string) => {
      const clickedIndex = items.findIndex((item) => getId(item) === id);
      if (clickedIndex === -1) {
        return;
      }

      const isShift = shiftDown.current;

      // Ensure a starting point for shift range if an anchor exists
      if (isShift && !rangeStartId.current && lastCheckedId.current) {
        rangeStartId.current = lastCheckedId.current;
      }

      // Start a new shift gesture if shift is down but we don't have a rangeStart yet.
      if (isShift && !rangeStartId.current) {
        rangeBase.current = new Set(selectedIds);

        // If no anchor yet (clean slate + shift held), treat first click as normal toggle
        if (!lastCheckedId.current) {
          const next = new Set(selectedIds);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }

          onChange(next);
          lastCheckedId.current = id;
          rangeStartId.current = id;
          rangeBase.current = new Set(next);
          return;
        }

        rangeStartId.current = lastCheckedId.current;
      }

      // Shift range apply (rolling base + moving start)
      if (isShift && rangeStartId.current) {
        const startIndex = items.findIndex((item) => getId(item) === rangeStartId.current);
        if (startIndex === -1) {
          return;
        }

        const from = Math.min(startIndex, clickedIndex);
        const to = Math.max(startIndex, clickedIndex);

        const shouldSelect = !selectedIds.has(id);
        const next = new Set(rangeBase.current);

        for (let i = from; i <= to; i++) {
          const itemId = getId(items[i]);
          if (shouldSelect) {
            next.add(itemId);
          } else {
            next.delete(itemId);
          }
        }

        onChange(next);
        rangeStartId.current = id;
        rangeBase.current = new Set(next);
        return;
      }

      // Normal click
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      onChange(next);
      lastCheckedId.current = id;
      rangeStartId.current = null;
      rangeBase.current = new Set(next); // Update base for future shift clicks
    },
    [items, selectedIds, onChange, getId],
  );

  const resetSelectionHistory = useCallback(() => {
    lastCheckedId.current = null;
    rangeStartId.current = null;
    rangeBase.current = new Set();
  }, []);

  return {
    handleSelection,
    resetSelectionHistory,
    shiftDown, // Exposed in case needed
  };
}
