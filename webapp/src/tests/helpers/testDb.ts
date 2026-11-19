import Database from 'better-sqlite3';

export interface SeedThreadInput {
  id: string;
  platform: string;
  title?: string | null;
  participants?: string[];
  is_group?: boolean;
  last_activity_ms?: number;
  snippet?: string | null;
  labels?: string[];
}

export interface SeedMessageInput {
  thread_id: string;
  sender_name: string;
  timestamp_ms: number;
  content?: string | null;
  media_json?: string | null;
  reactions_json?: string | null;
  share_json?: string | null;
  annotations_json?: string | null;
}

/**
 * Creates an in-memory SQLite database matching the production schema in data_samples/messagehub.db.
 */
export function createMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      platform TEXT,
      title TEXT,
      participants_json TEXT,
      is_group BOOLEAN,
      last_activity_ms INTEGER,
      snippet TEXT
    );
    CREATE TABLE thread_labels (
      thread_id TEXT,
      label TEXT,
      PRIMARY KEY (thread_id, label),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_thread_labels_label ON thread_labels(label);
    CREATE TABLE content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT,
      sender_name TEXT,
      timestamp_ms INTEGER,
      content TEXT,
      media_json TEXT,
      reactions_json TEXT,
      share_json TEXT,
      annotations_json TEXT,
      UNIQUE(thread_id, sender_name, timestamp_ms, content)
    );
    CREATE TABLE identities (
      platform TEXT,
      id_type TEXT,
      id_value TEXT,
      is_me BOOLEAN DEFAULT 0,
      metadata_json TEXT,
      PRIMARY KEY (platform, id_type, id_value)
    );
    CREATE INDEX idx_content_thread_id ON content(thread_id);
    CREATE INDEX idx_content_timestamp ON content(timestamp_ms);
    CREATE INDEX idx_content_sender_name ON content(sender_name);
    CREATE INDEX idx_threads_platform ON threads(platform);
  `);
  return db;
}

/**
 * Inserts a thread row and optional labels into the given SQLite database.
 */
export function seedThread(db: Database.Database, input: SeedThreadInput): void {
  db.prepare(
    `
    INSERT INTO threads (id, platform, title, participants_json, is_group, last_activity_ms, snippet)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    input.id,
    input.platform,
    input.title ?? null,
    JSON.stringify(input.participants ?? []),
    input.is_group ? 1 : 0,
    input.last_activity_ms ?? 0,
    input.snippet ?? null,
  );

  if (input.labels && input.labels.length > 0) {
    const insertLabel = db.prepare('INSERT INTO thread_labels (thread_id, label) VALUES (?, ?)');
    for (const label of input.labels) {
      insertLabel.run(input.id, label);
    }
  }
}

/**
 * Inserts a content message row and returns its autoincrement row ID.
 */
export function seedMessage(db: Database.Database, input: SeedMessageInput): number {
  const result = db
    .prepare(
      `
    INSERT INTO content (
      thread_id, sender_name, timestamp_ms, content, media_json, reactions_json, share_json, annotations_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      input.thread_id,
      input.sender_name,
      input.timestamp_ms,
      input.content ?? null,
      input.media_json ?? null,
      input.reactions_json ?? null,
      input.share_json ?? null,
      input.annotations_json ?? null,
    );

  return Number(result.lastInsertRowid);
}
