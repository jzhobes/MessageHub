import { ContentRecord, MediaItem } from '@/lib/shared/types';

export interface RawContentRow {
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

/**
 * Get the lowercase extension, including the dot, without importing Node's `path`.
 */
export function getFileExtension(uri: string): string {
  const clean = uri.split('?')[0].split('#')[0];
  const lastSlash = clean.lastIndexOf('/');
  const baseName = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0) {
    return '';
  }
  return baseName.slice(dotIdx).toLowerCase();
}

/**
 * Turn raw rows into `ContentRecord` bubbles. Use file extensions to identify generic attachments,
 * expand Google Chat annotations, and format virtual Facebook events and posts.
 * Split text and media into two bubbles unless they look like one photo with a link preview.
 */
export function transformContentRows(rows: RawContentRow[], myNames: string[], threadIdStr: string): ContentRecord[] {
  return rows.flatMap((row) => {
    interface MediaJsonItem {
      uri: string;
      type: string;
    }

    const media: MediaJsonItem[] = JSON.parse(row.media_json || '[]');
    const photos: MediaItem[] = media.filter((m) => m.type === 'photo' || m.type === 'image');
    const videos: MediaItem[] = media.filter((m) => m.type === 'video');
    const audio: MediaItem[] = media.filter((m) => m.type === 'audio');
    const gifs: MediaItem[] = media.filter((m) => m.type === 'gif');
    const stickers: MediaItem[] = media.filter((m) => m.type === 'sticker');
    const files: MediaItem[] = media.filter((m) => m.type === 'file');
    const otherFiles: MediaItem[] = [];

    // Check generic file attachments for photo or video extensions.
    files.forEach((f) => {
      const ext = getFileExtension(f.uri);
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
        // Use the actual text for posts and check-ins when we have it.
        // Otherwise show the title, such as “Your Post.”
        displayContent = row.content || row.event_title;
      } else {
        displayContent = `${row.event_title}${row.content ? `: ${row.content}` : ''}`;
      }
    }
    const hasText = !!displayContent || !!quoted_message_metadata || !!shareObj;

    const result: ContentRecord[] = [];

    // Show text and media in separate bubbles to match the original conversation.
    // Keep a link with its one photo if it looks like a preview.
    // The frontend uses both to avoid showing the same image twice.
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
        reactions: reactions, // Put reactions on the media bubble when we split the message.
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
        audio: audio.length ? audio : undefined,
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
        audio: audio.length ? audio : undefined,
        attachments: otherFiles.length ? otherFiles : undefined,
        sticker: stickers.length > 0 ? stickers[0] : undefined,
        reactions: reactions,
        event_metadata: eventMetadata,
      });
    }

    // Keep a basic bubble if no display records were built.
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
}
