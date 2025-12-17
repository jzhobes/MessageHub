export interface Thread {
  id: string;
  title: string;
  timestamp: number;
  snippet?: string;
  file_count?: number; // pagination helper
  platform?: string;
  is_group?: number;
  // Dataset Studio Metadata
  qualityScore?: number;
  participationRatio?: number;
  myAvgMessageLength?: number;
  myMessageCount?: number;
  platform_source?: string;
}

export interface Reaction {
  reaction: string;
  actor: string;
}

export interface QuotedMessageMetadata {
  creator?: {
    name: string;
  };
  text?: string;
}

interface MediaItem {
  uri: string;
}

export interface Message {
  id?: string;
  is_sender?: boolean;
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: MediaItem[];
  videos?: MediaItem[];
  gifs?: MediaItem[];
  sticker?: {
    uri: string;
  };
  share?: {
    link?: string;
    share_text?: string;
  };
  reactions?: Reaction[];
  quoted_message_metadata?: QuotedMessageMetadata;
  // Raw DB columns for internal processing
  media_json?: string;
  reactions_json?: string;
}
