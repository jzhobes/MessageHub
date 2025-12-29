import path from 'path';

import db from '@/lib/server/db';
import { getMyNames } from '@/lib/server/identity';
import { ContentRecord, MediaItem } from '@/lib/shared/types';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { threadId, page = '1' } = req.query;

  if (!threadId) {
    return res.status(400).json({ error: 'Missing threadId' });
  }

  const threadIdStr = Array.isArray(threadId) ? threadId[0] : threadId;
  const pageNum = parseInt(Array.isArray(page) ? page[0] : page, 10) || 1;
  const PAGE_SIZE = 100; // SQLite pagination size
  const offset = (pageNum - 1) * PAGE_SIZE;

  // Identify "Me"
  const myNames = await getMyNames();

  try {
    if (!db.exists()) {
      return res.status(200).json([]);
    }

    interface ContentRow {
      id: number;
      thread_id: string;
      sender_name: string;
      timestamp_ms: number;
      content: string | null;
      media_json: string | null;
      reactions_json: string | null;
      share_json: string | null;
      annotations_json: string | null;
      event_title?: string;
    }

    let rows: ContentRow[] = [];

    if (threadIdStr.startsWith('fb-event-') || threadIdStr === 'fb-post-all' || threadIdStr === 'fb-checkin-all') {
      const catMap: Record<string, string | null> = {
        'fb-event-owned': 'Created Event',
        'fb-event-joined': 'Joined Event',
        'fb-event-interested': 'Interested in Event',
        'fb-event-declined': 'Declined Event',
        'fb-post-all': null,
        'fb-checkin-all': null,
      };

      const statusCondition = threadIdStr.startsWith('fb-event-') ? 'AND c.content = ?' : '';
      const label = threadIdStr.includes('post') ? 'post' : threadIdStr.includes('checkin') ? 'checkin' : 'event';
      const statusValue = catMap[threadIdStr];

      const queryParams: (string | number)[] = [];
      if (statusValue) {
        queryParams.push(statusValue);
      }
      queryParams.push(PAGE_SIZE, offset);

      rows = db
        .get()
        .prepare(
          `
        SELECT c.*, MAX(t.title) as event_title 
        FROM content c
        INNER JOIN threads t ON c.thread_id = t.id
        INNER JOIN thread_labels tl ON t.id = tl.thread_id
        WHERE tl.label = '${label}' ${statusCondition}
        GROUP BY c.timestamp_ms
        ORDER BY c.timestamp_ms DESC
        LIMIT ? OFFSET ?
      `,
        )
        .all(...queryParams) as ContentRow[];
    } else {
      const isFbEvent = threadIdStr.startsWith('fb_event_');
      const groupBy = isFbEvent ? 'GROUP BY timestamp_ms' : '';

      rows = db
        .get()
        .prepare(
          `
        SELECT * FROM content 
        WHERE thread_id = ? 
        ${groupBy}
        ORDER BY timestamp_ms DESC 
        LIMIT ? OFFSET ?
    `,
        )
        .all(threadIdStr, PAGE_SIZE, offset) as ContentRow[];
    }

    // If page 1 and empty, check if thread exists?

    const records: ContentRecord[] = rows.flatMap((row) => {
      interface MediaJsonItem {
        uri: string;
        type: string;
      }

      const media: MediaJsonItem[] = JSON.parse(row.media_json || '[]');
      const photos: MediaItem[] = media.filter((m) => m.type === 'photo' || m.type === 'image');
      const videos: MediaItem[] = media.filter((m) => m.type === 'video');
      const gifs: MediaItem[] = media.filter((m) => m.type === 'gif');
      const stickers: MediaItem[] = media.filter((m) => m.type === 'sticker');
      const files: MediaItem[] = media.filter((m) => m.type === 'file');
      const otherFiles: MediaItem[] = [];

      // Post-process 'files' (e.g. from Google Chat) to see if they are actually photos/videos
      files.forEach((f) => {
        const ext = path.extname(f.uri).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic'].includes(ext)) {
          photos.push(f);
        } else if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) {
          videos.push(f);
        } else {
          otherFiles.push(f);
        }
      });

      // Handle Annotations (Google Chat Images)
      if (row.annotations_json) {
        const annotations: {
          url_metadata?: {
            image_url?: string;
          };
        }[] = JSON.parse(row.annotations_json);
        annotations.forEach((a) => {
          if (a.url_metadata?.image_url) {
            photos.push({ uri: a.url_metadata.image_url });
          }
        });
      }

      const share = row.share_json ? JSON.parse(row.share_json) : undefined;
      let quoted_message_metadata = undefined;
      let shareObj = undefined;

      if (share) {
        if (share.quoted_message) {
          quoted_message_metadata = {
            creator:
              typeof share.quoted_message.creator === 'string'
                ? { name: share.quoted_message.creator }
                : share.quoted_message.creator,
            text: share.quoted_message.text,
          };
        } else {
          shareObj = share;
        }
      }

      const reactions = row.reactions_json ? JSON.parse(row.reactions_json) : undefined;
      const isSender = myNames.includes(row.sender_name);

      const hasMedia = photos.length > 0 || videos.length > 0 || gifs.length > 0 || stickers.length > 0;
      let displayContent = row.content ?? undefined;

      let eventMetadata: { location?: string; description?: string } | undefined = undefined;

      if (row.event_title) {
        if (threadIdStr.startsWith('fb-event-')) {
          displayContent = row.event_title;
          if (share && (share.location || share.description)) {
            eventMetadata = {
              location: share.location as string,
              description: share.description as string,
            };
          }
        } else if (threadIdStr.startsWith('fb-post-') || threadIdStr.startsWith('fb-checkin-')) {
          // For posts and check-ins, prefer the actual content if available,
          // otherwise fallback to the title (e.g. "Your Post" if no text)
          displayContent = row.content || row.event_title;
        } else {
          displayContent = `${row.event_title}${row.content ? `: ${row.content}` : ''}`;
        }
      }
      const hasText = !!displayContent || !!quoted_message_metadata || !!shareObj;

      const result: ContentRecord[] = [];

      // Logic to split Text and Media into separate bubbles to match original UI behavior.
      // However, if the message looks like a Link Preview (Text + 1 Photo), we keep them together
      // so the frontend can deduplicate the image.
      const hasLink = row.content && /(https?:\/\/[^\s]+)/.test(row.content);
      const isLikelyPreview =
        hasText &&
        hasMedia &&
        hasLink &&
        photos.length === 1 &&
        videos.length === 0 &&
        gifs.length === 0 &&
        stickers.length === 0;
      const shouldSplit = hasMedia && hasText && !isLikelyPreview;

      if (shouldSplit) {
        // Split Media and Text
        result.push({
          id: `${row.id}_media`,
          is_sender: isSender,
          sender_name: row.sender_name,
          timestamp_ms: row.timestamp_ms,
          content: undefined, // Image only
          photos: photos.length ? photos : undefined,
          videos: videos.length ? videos : undefined,
          gifs: gifs.length ? gifs : undefined,
          sticker: stickers.length > 0 ? stickers[0] : undefined,
          reactions: reactions, // Attach reactions to media preference
          event_metadata: eventMetadata,
        });

        result.push({
          id: row.id.toString(),
          is_sender: isSender,
          sender_name: row.sender_name,
          timestamp_ms: row.timestamp_ms,
          content: displayContent,
          quoted_message_metadata,
          share: shareObj,
          attachments: otherFiles.length ? otherFiles : undefined,
          reactions: undefined, // Reactions attached to media
          event_metadata: eventMetadata,
        });
      } else {
        // Unified Message (either single type, or merged preview)
        result.push({
          id: row.id.toString(),
          is_sender: isSender,
          sender_name: row.sender_name,
          timestamp_ms: row.timestamp_ms,
          content: displayContent,
          quoted_message_metadata,
          share: shareObj,
          photos: photos.length ? photos : undefined,
          videos: videos.length ? videos : undefined,
          gifs: gifs.length ? gifs : undefined,
          attachments: otherFiles.length ? otherFiles : undefined,
          sticker: stickers.length > 0 ? stickers[0] : undefined,
          reactions: reactions,
          event_metadata: eventMetadata,
        });
      }

      // Fallback for empty (shouldn't happen with valid data)
      if (result.length === 0) {
        result.push({
          id: row.id.toString(),
          is_sender: isSender,
          sender_name: row.sender_name,
          timestamp_ms: row.timestamp_ms,
          content: displayContent,
          event_metadata: eventMetadata,
        });
      }

      return result;
    });

    return res.status(200).json({ records });
  } catch (e) {
    console.error('Error querying messages:', e);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
}
