import path from 'path';

import db from '@/lib/server/db';

import type { NextApiRequest, NextApiResponse } from 'next';

interface MediaItem {
  messageId: number;
  threadId: string;
  timestamp: number;
  mediaUrl: string;
  mediaType: 'photo' | 'video' | 'gif' | 'sticker';
  thumbnailUrl?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { threadId } = req.query;

    if (!threadId || typeof threadId !== 'string') {
      return res.status(400).json({ error: 'Thread ID is required' });
    }

    if (!db.exists()) {
      return res.status(200).json({ media: [], total: 0 });
    }

    const dbInstance = db.get();

    // Get all messages with media for this thread
    const rows = dbInstance
      .prepare(
        `
        SELECT id, thread_id, timestamp_ms, media_json
        FROM content
        WHERE thread_id = ? AND media_json IS NOT NULL
        ORDER BY timestamp_ms DESC
      `,
      )
      .all(threadId) as Array<{
      id: number;
      thread_id: string;
      timestamp_ms: number;
      media_json: string;
    }>;

    const media: MediaItem[] = [];

    rows.forEach((row) => {
      try {
        const mediaArray = JSON.parse(row.media_json);
        if (Array.isArray(mediaArray)) {
          mediaArray.forEach((item: { type: string; uri: string; thumbnail_uri?: string }) => {
            // Only include photos, videos, gifs, and stickers
            let actualType = item.type;
            if (actualType === 'file' && item.uri) {
              const ext = path.extname(item.uri).toLowerCase();
              if (['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext)) {
                actualType = 'photo';
              } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
                actualType = 'video';
              } else if (ext === '.gif') {
                actualType = 'gif';
              }
            }

            if (['photo', 'video', 'gif', 'sticker'].includes(actualType)) {
              media.push({
                messageId: row.id,
                threadId: row.thread_id,
                timestamp: row.timestamp_ms,
                mediaUrl: item.uri,
                mediaType: actualType as 'photo' | 'video' | 'gif' | 'sticker',
                thumbnailUrl: item.thumbnail_uri,
              });
            }
          });
        }
      } catch {
        // Skip invalid JSON
      }
    });

    return res.status(200).json({
      media,
      total: media.length,
    });
  } catch (error) {
    console.error('Media gallery error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
