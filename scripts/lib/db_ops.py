import json
import sqlite3
from pathlib import Path

# Local parser imports
from parsers.google_mail import discover_google_mail_identity

# --- Schema Definition ---
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    platform TEXT,
    title TEXT,
    participants_json TEXT,  -- JSON array of normalized names
    is_group BOOLEAN,
    last_activity_ms INTEGER,
    snippet TEXT
);

CREATE TABLE IF NOT EXISTS thread_labels (
    thread_id TEXT,
    label TEXT,
    PRIMARY KEY (thread_id, label),
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_labels_label ON thread_labels(label);

CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT,
    sender_name TEXT,
    timestamp_ms INTEGER,
    content TEXT,
    media_json TEXT,         -- JSON array: [{"uri": "path/to/file", "type": "image"}]
    reactions_json TEXT,     -- JSON array: [{"reaction": "❤️", "actor": "Name"}]
    share_json TEXT,         -- JSON object: {"link": "url", "share_text": "..."}
    annotations_json TEXT,   -- JSON array: Google Chat annotations
    
    -- Constraint to prevent duplicates from overlapping exports
    UNIQUE(thread_id, sender_name, timestamp_ms, content)
);

-- Virtual Table for Full-Text Search
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
    content,
    content='content',
    content_rowid='id',
    tokenize='trigram'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS content_ai AFTER INSERT ON content BEGIN
    INSERT INTO content_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS content_ad AFTER DELETE ON content BEGIN
    INSERT INTO content_fts(content_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS content_au AFTER UPDATE ON content BEGIN
    INSERT INTO content_fts(content_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO content_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TABLE IF NOT EXISTS identities (
    platform TEXT,
    id_type TEXT, -- 'email', 'name', 'id'
    id_value TEXT,
    is_me BOOLEAN DEFAULT 0,
    metadata_json TEXT, -- Optional: extra names, counts, etc.
    PRIMARY KEY (platform, id_type, id_value)
);

CREATE INDEX IF NOT EXISTS idx_content_thread_id ON content(thread_id);
CREATE INDEX IF NOT EXISTS idx_content_timestamp ON content(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_content_sender_name ON content(sender_name);
CREATE INDEX IF NOT EXISTS idx_threads_platform ON threads(platform);
"""


def get_db_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path):
    # Ensure parent directory exists
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    conn = get_db_connection(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    print(f"Database initialized at {db_path}")


def save_identity(cursor, platform, id_type, id_value, is_me=False, metadata=None):
    """Inserts or updates an identity record safely."""
    cursor.execute(
        """
        INSERT OR REPLACE INTO identities (platform, id_type, id_value, is_me, metadata_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        (platform, id_type, id_value, 1 if is_me else 0, json.dumps(metadata) if metadata else None),
    )


def finalize_gmail_identity(cursor, gmail_identity_stats):
    """Determines the most likely owner of the Gmail account based on 'To' field counts."""
    result = discover_google_mail_identity(gmail_identity_stats)
    if not result:
        return

    best_email, names, count = result
    print(f"[Identity]: Identified Gmail owner as {best_email} ({count} messages)")

    save_identity(cursor, "google_mail", "email", best_email, is_me=True, metadata={"count": count, "names": names})

    # Also register the names as 'Me' for this platform
    for name in names:
        save_identity(cursor, "google_mail", "name", name, is_me=True)
