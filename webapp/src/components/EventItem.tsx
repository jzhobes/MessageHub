import React from 'react';

import { FaMapMarkerAlt } from 'react-icons/fa';

import { ContentRecord } from '@/lib/shared/types';

import styles from './EventItem.module.css';

interface EventItemProps {
  msg: ContentRecord;
  isMyMsg?: boolean;
  isTarget?: boolean;
  highlightToken?: number;
}

export default function EventItem({ msg, isMyMsg, isTarget, highlightToken }: EventItemProps) {
  const { content, event_metadata } = msg;
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isTarget && bubbleRef.current && highlightToken) {
      const color = isMyMsg ? 'var(--bubble-sent-bg)' : 'var(--bubble-received-bg)';
      const animation = bubbleRef.current.animate(
        [
          { transform: 'scale(1)', boxShadow: '0 0 0 0 var(--highlight-border)' },
          { transform: 'scale(1.02)', boxShadow: `0 0 0 5px ${color}` },
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)' },
        ],
        { duration: 1000, easing: 'ease-in-out' },
      );
      return () => animation.cancel();
    }
  }, [isTarget, highlightToken, isMyMsg]);

  return (
    <div className={`${styles.eventRow} ${isMyMsg ? styles.justifyRight : styles.justifyLeft}`}>
      <div className={styles.eventContentStack}>
        <div ref={bubbleRef} className={`${styles.eventContainer} ${isMyMsg ? styles.myEvent : styles.otherEvent}`}>
          <div className={styles.eventName}>{content}</div>
          {event_metadata?.location && (
            <div className={styles.eventLocation}>
              <FaMapMarkerAlt className={styles.locationIcon} />
              {event_metadata.location}
            </div>
          )}
          {event_metadata?.description && <div className={styles.eventDescription}>{event_metadata.description}</div>}
        </div>
      </div>
    </div>
  );
}
