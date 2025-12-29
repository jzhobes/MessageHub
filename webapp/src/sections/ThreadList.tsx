import React, { useMemo } from 'react';

import {
  FaCalendarAlt,
  FaChevronDown,
  FaCommentAlt,
  FaFileAlt,
  FaInbox,
  FaMapMarkerAlt,
  FaPaperPlane,
  FaSpinner,
  FaUser,
  FaUsers,
} from 'react-icons/fa';
import { Virtuoso } from 'react-virtuoso';

import { Dropdown, DropdownItem } from '@/components/Dropdown';

import { Thread } from '@/lib/shared/types';

import styles from './ThreadList.module.css';

interface ThreadListProps {
  activePlatform: string;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  categoryCounts?: Record<string, number>;
  threads: Thread[];
  activeThread: Thread | null;
  loading: boolean;
  onThreadSelect: (thread: Thread) => void;
}

const ALL_CATEGORIES = [
  { id: 'message', label: 'Messages', icon: <FaCommentAlt size={14} color="#0084FF" /> }, // Messenger Blue
  { id: 'event', label: 'Events', icon: <FaCalendarAlt size={14} color="#F35E5E" /> }, // FB Event Red
  { id: 'post', label: 'Posts', icon: <FaFileAlt size={14} color="#45BD62" /> }, // FB Post Green
  { id: 'checkin', label: 'Check-ins', icon: <FaMapMarkerAlt size={14} color="#F02849" /> }, // FB Check-in Red
  { id: 'inbox', label: 'Inbox', icon: <FaInbox size={14} color="#34A853" /> }, // Google Green
  { id: 'sent', label: 'Sent', icon: <FaPaperPlane size={14} color="#4285F4" /> }, // Google Blue
  { id: 'dm', label: 'Direct Messages', icon: <FaUser size={14} color="#007AFF" /> },
  { id: 'group', label: 'Group Messages', icon: <FaUsers size={14} color="#5856D6" /> },
];

export default function ThreadList({
  activePlatform,
  activeCategory,
  onCategoryChange,
  categoryCounts = {},
  threads,
  activeThread,
  loading,
  onThreadSelect,
}: ThreadListProps) {
  const filteredCategories = useMemo(() => {
    if (activePlatform === 'Facebook') {
      return ALL_CATEGORIES.filter((c) => !['inbox', 'sent', 'dm', 'group'].includes(c.id));
    }
    if (activePlatform === 'Instagram') {
      return ALL_CATEGORIES.filter((c) => c.id === 'message' || c.id === 'post');
    }
    if (activePlatform === 'Gmail') {
      return ALL_CATEGORIES.filter((c) => c.id === 'inbox' || c.id === 'sent');
    }
    if (activePlatform === 'Google Chat') {
      return ALL_CATEGORIES.filter((c) => ['message', 'dm', 'group'].includes(c.id)).map((c) =>
        c.id === 'message' ? { ...c, label: 'All Messages' } : c,
      );
    }
    return ALL_CATEGORIES.filter((c) => c.id === 'message');
  }, [activePlatform]);

  const currentCategory = useMemo(
    () => filteredCategories.find((c) => c.id === activeCategory) || filteredCategories[0],
    [activeCategory, filteredCategories],
  );

  const hasMultipleCategories = filteredCategories.length > 1;

  const headerTitle = (
    <div className={`${styles.categoryTrigger} ${hasMultipleCategories ? styles.categoryTriggerInteractive : ''}`}>
      <span className={styles.categoryIcon}>{currentCategory.icon}</span>
      <div className={styles.categoryTitle}>{currentCategory.label}</div>
      {hasMultipleCategories && <FaChevronDown className={styles.categoryChevron} />}
    </div>
  );

  return (
    <div className={styles.threadList}>
      <div className={styles.threadListHeader}>
        {hasMultipleCategories ? (
          <Dropdown
            trigger={headerTitle}
            width="100%"
            className={styles.headerDropdown}
            menuClassName={styles.fullWidthMenu}
            align="left"
            gap={0}
          >
            {filteredCategories.map((cat) => (
              <DropdownItem
                key={cat.id}
                className={`${styles.categoryDropdownItem} ${activeCategory === cat.id ? styles.dropdownItemActive : ''}`}
                disabled={categoryCounts[cat.id] === 0 && activeCategory !== cat.id}
                onClick={() => onCategoryChange(cat.id)}
              >
                <span className={styles.categoryIcon}>{cat.icon}</span>
                <div style={{ flex: 1 }}>{cat.label}</div>
                {categoryCounts[cat.id] !== undefined && (
                  <span style={{ fontSize: '11px', opacity: 0.6 }}>{categoryCounts[cat.id].toLocaleString()}</span>
                )}
              </DropdownItem>
            ))}
          </Dropdown>
        ) : (
          headerTitle
        )}
      </div>
      <div className={styles.threadScrollContainer}>
        {loading ? (
          <div className={styles.loadingContainer}>
            <FaSpinner className="spinner" size={24} />
            <span className={styles.loadingText}>Loading...</span>
          </div>
        ) : threads.length === 0 ? (
          <div className={styles.noThreads}>No {currentCategory.label.toLowerCase()} found</div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={threads}
            itemContent={(index, thread) => (
              <div
                key={thread.id}
                className={`${styles.threadItem} ${activeThread?.id === thread.id ? styles.threadItemActive : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onThreadSelect(thread)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onThreadSelect(thread);
                  }
                }}
              >
                <div className={styles.threadName}>{thread.title}</div>
                <div className={styles.threadTime}>
                  {thread.timestamp ? new Date(thread.timestamp).toLocaleDateString() : ''}
                </div>
                <div className={styles.threadSnippet}>{thread.snippet || `(No content)`}</div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
