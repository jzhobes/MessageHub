export interface DemoIdentityRow {
  platform: string;
  id_type: string;
  id_value: string;
  is_me: number | boolean;
  metadata_json?: string | null;
}

export interface DemoThreadRow {
  id: string;
  platform: string;
  title: string | null;
  participants_json: string | null;
  is_group: number | boolean | null;
  last_activity_ms: number | null;
  snippet: string | null;
  archived?: number | boolean | null;
  e2ee_cutover?: number | boolean | null;
}

export interface DemoThreadLabelRow {
  thread_id: string;
  label: string;
}

export interface DemoContentRow {
  id: number;
  thread_id: string;
  sender_name: string;
  timestamp_ms: number;
  content: string | null;
  media_json: string | null;
  reactions_json: string | null;
  share_json: string | null;
  annotations_json: string | null;
}

export interface DemoLinkPreview {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface DemoDataBundle {
  identities: DemoIdentityRow[];
  threads: DemoThreadRow[];
  thread_labels: DemoThreadLabelRow[];
  content: DemoContentRow[];
  mediaManifest: Record<string, string>;
  linkPreviews?: Record<string, DemoLinkPreview>;
}
