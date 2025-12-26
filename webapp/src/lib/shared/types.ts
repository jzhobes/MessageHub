/**
 * Shared Type Definitions
 */

export interface PathMetadata {
  exists: boolean;
  isWritable: boolean;
  isEmpty: boolean;
  isNested: boolean;
  isActive: boolean;
  isExistingWorkspace: boolean;
}

export interface MediaItem {
  uri: string;
}

export interface Reaction {
  reaction: string;
  actor: string;
}

export interface QuotedMessageMetadata {
  creator: {
    name: string;
  };
  text?: string;
}

export interface ContentRecord {
  id: string;
  is_sender: boolean;
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: MediaItem[];
  videos?: MediaItem[];
  gifs?: MediaItem[];
  attachments?: MediaItem[];
  sticker?: MediaItem;
  reactions?: Reaction[];
  quoted_message_metadata?: QuotedMessageMetadata;
  share?: {
    link?: string;
    [key: string]: unknown;
  };
  // DB Fields (used in DatasetGenerator/Ingestion)
  media_json?: string;
  reactions_json?: string;
}

export interface Thread {
  id: string;
  title: string;
  participants: string[];
  timestamp: number;
  snippet: string;
  pageCount: number;

  // Platform info
  platform?: string;
  platform_source?: string;
  is_group?: boolean;

  // Studio / Extended Stats
  messageCount?: number;
  myMessageCount?: number;
  participationRatio?: number;
  myAvgMessageLength?: number;
  qualityScore?: number;
}

export interface SearchResult {
  id: number;
  thread_id: string;
  thread_title: string | null;
  platform: string;
  sender_name: string;
  timestamp: number;
  content: string;
  snippet: string;
}

export interface SearchFacets {
  platforms: Record<string, number>;
  senders: Record<string, number>;
}
