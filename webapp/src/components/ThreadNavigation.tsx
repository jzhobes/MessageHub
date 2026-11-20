import { useEffect, useId, useRef, useState } from 'react';

import { FaChevronDown } from 'react-icons/fa';

import { Dropdown } from '@/components/Dropdown';
import TextInput from '@/components/TextInput';

import { apiFetch } from '@/lib/client/apiClient';

import styles from './ThreadNavigation.module.css';

interface ThreadNavigationProps {
  threadId: string;
  currentPage: number;
  currentTimestamp?: number;
  totalPages: number;
  onNavigate: (page: number, timestamp?: number) => Promise<void>;
}

export default function ThreadNavigation({
  threadId,
  currentPage,
  currentTimestamp,
  totalPages,
  onNavigate,
}: ThreadNavigationProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [page, setPage] = useState(String(currentPage));
  const [mode, setMode] = useState<'date' | 'page'>('date');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const id = useId();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const navigate = async (targetPage?: number) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let timestamp: number | undefined;
      let matchedDate: string | undefined;
      if (targetPage === undefined) {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const params = new URLSearchParams({ threadId, date, timeZone });
        const response = await apiFetch(`/api/jump?${params}`);
        if (!response.ok) {
          throw new Error('Unable to find messages for this date.');
        }
        const result = await response.json();
        targetPage = result.page;
        timestamp = result.timestamp;
        matchedDate = result.matchedDate;
      }
      if (!active.current) {
        return;
      }
      await onNavigate(targetPage!, timestamp);
      if (!active.current) {
        return;
      }
      if (matchedDate && matchedDate !== date) {
        setNotice(`No messages on ${date}. Showing ${matchedDate}.`);
      } else {
        setOpen(false);
      }
    } catch (e) {
      if (active.current) {
        setError(e instanceof Error ? e.message : 'Unable to navigate. Please try again.');
      }
    } finally {
      if (active.current) {
        setBusy(false);
      }
    }
  };

  return (
    <Dropdown
      open={open}
      align="right"
      width={280}
      className={styles.triggerButton}
      menuClassName={styles.menu}
      trigger={
        <span className={styles.trigger}>
          Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()} <FaChevronDown size={10} />
        </span>
      }
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setMode('date');
          setPage(String(currentPage));
          if (currentTimestamp !== undefined) {
            const current = new Date(currentTimestamp);
            setDate(
              `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`,
            );
          }
          setError('');
          setNotice('');
        }
        setOpen(nextOpen);
      }}
    >
      <div
        className={styles.panel}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            event.stopPropagation();
          }
        }}
      >
        <h3 className={styles.heading}>Jump to</h3>
        <div className={styles.tabs} role="group" aria-label="Jump by">
          {(['date', 'page'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              disabled={busy}
              onClick={() => setMode(option)}
            >
              {option === 'date' ? 'Date' : 'Page'}
            </button>
          ))}
        </div>
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === 'date') {
              if (date) {
                void navigate();
              }
            } else {
              const value = Number(page);
              if (Number.isInteger(value) && value >= 1 && value <= totalPages) {
                void navigate(value);
              }
            }
          }}
        >
          {mode === 'date' ? (
            <TextInput
              id={`${id}-date`}
              aria-label="Jump to date"
              type="date"
              value={date}
              className={styles.jumpField}
              disabled={busy}
              required
              onChange={(event) => setDate(event.target.value)}
            />
          ) : (
            <TextInput
              id={`${id}-page`}
              aria-label={`Go to page (1–${totalPages.toLocaleString()})`}
              type="number"
              min={1}
              max={totalPages}
              step={1}
              value={page}
              adornment={<span className={styles.pageAdornment}>Page</span>}
              className={styles.jumpField}
              suffix={<span className={styles.pageAdornment}>of {totalPages.toLocaleString()}</span>}
              disabled={busy}
              required
              onChange={(event) => setPage(event.target.value)}
            />
          )}
          <button className={styles.goButton} disabled={busy || !(mode === 'date' ? date : page)}>
            Go
          </button>
        </form>
        {busy && <span role="status">Jumping…</span>}
        {notice && <span role="status">{notice}</span>}
        {error && <span role="alert">{error}</span>}
        <div className={styles.shortcuts}>
          <button
            type="button"
            className={styles.shortcutButton}
            disabled={busy}
            onClick={() => void navigate(totalPages)}
          >
            Oldest
          </button>
          <button type="button" className={styles.shortcutButton} disabled={busy} onClick={() => void navigate(1)}>
            Newest
          </button>
        </div>
      </div>
    </Dropdown>
  );
}
