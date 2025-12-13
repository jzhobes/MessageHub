import sqlite3
import json
import argparse
import re
import zipfile
from pathlib import Path
from utils import fix_text, parse_iso_time, DATA_DIR, PROJECT_ROOT

# --- Constants ---
DB_NAME = "messagehub.db"


def normalize_participants(participant_list):
    """Normalizes participant names for consistent ID generation."""
    clean = [fix_text(p).strip() for p in participant_list if p]
    return sorted(list(set(clean)))


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

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT,
    sender_name TEXT,
    timestamp_ms INTEGER,
    content TEXT,
    media_json TEXT,         -- JSON array: [{"uri": "path/to/file", "type": "image"}]
    reactions_json TEXT,     -- JSON array: [{"reaction": "❤️", "actor": "Name"}]
    share_json TEXT,         -- JSON object: {"link": "url", "share_text": "..."}
    annotations_json TEXT,   -- JSON array: Google Chat annotations (links, mentions)
    
    -- Constraint to prevent duplicates from overlapping exports
    UNIQUE(thread_id, sender_name, timestamp_ms, content)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_name ON messages(sender_name);
CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
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


# --- Ingestion Logic ---


def ingest_facebook_instagram_thread(cursor, thread_dir, platform, thread_id_override=None):
    """Ingests a single Facebook or Instagram thread folder."""
    thread_path = Path(thread_dir)

    # Identify Thread ID (Folder Name)
    thread_id = thread_id_override if thread_id_override else thread_path.name

    # Collect all message json files (message_1.json, message_2.json, ...)
    message_files = sorted(thread_path.glob("message_*.json"))

    if not message_files:
        return 0

    # Parse Metadata (Title, Participants) from the first file (usually newest)
    title = ""
    participants = []

    # Scan specifically to find metadata
    for mf in message_files:
        try:
            with mf.open("r", encoding="utf-8") as f:
                data = json.load(f)
                if "title" in data and not title:
                    title = fix_text(data["title"])
                if "participants" in data and not participants:
                    participants = [fix_text(p["name"]) for p in data["participants"] if "name" in p]
                if title and participants:
                    break
        except Exception:
            continue

    # Insert Thread
    participants_json = json.dumps(normalize_participants(participants))
    is_group = len(participants) > 2

    cursor.execute(
        """
        INSERT OR REPLACE INTO threads (id, platform, title, participants_json, is_group)
        VALUES (?, ?, ?, ?, ?)
    """,
        (thread_id, platform, title, participants_json, is_group),
    )

    msg_count = 0
    skipped_count = 0
    last_activity_ms = 0
    latest_snippet = ""

    # Insert Messages
    for mf in message_files:
        try:
            with mf.open("r", encoding="utf-8") as f:
                data = json.load(f)
                messages = data.get("messages", [])

                for m in messages:
                    sender = fix_text(m.get("sender_name", "Unknown"))
                    ts = m.get("timestamp_ms", 0)
                    content = fix_text(m.get("content"))

                    # Media
                    media = []
                    if "photos" in m:
                        media.extend([{"uri": x.get("uri"), "type": "photo"} for x in m["photos"]])
                    if "videos" in m:
                        media.extend([{"uri": x.get("uri"), "type": "video"} for x in m["videos"]])
                    if "gifs" in m:
                        media.extend([{"uri": x.get("uri"), "type": "gif"} for x in m["gifs"]])
                    if "audio_files" in m:
                        media.extend([{"uri": x.get("uri"), "type": "audio"} for x in m["audio_files"]])
                    if "files" in m:
                        media.extend([{"uri": x.get("uri"), "type": "file"} for x in m["files"]])
                    if "sticker" in m:
                        # Sticker is usually a single object, not a list
                        s = m["sticker"]
                        if isinstance(s, dict) and "uri" in s:
                            media.append({"uri": s["uri"], "type": "sticker"})

                    media_json = json.dumps(media) if media else None

                    # Reactions
                    reactions = []
                    if "reactions" in m:
                        reactions = [
                            {"reaction": fix_text(r.get("reaction")), "actor": fix_text(r.get("actor"))}
                            for r in m["reactions"]
                        ]
                    reactions_json = json.dumps(reactions) if reactions else None

                    # Share
                    share_json = None
                    if "share" in m:
                        share_data = m["share"]
                        if "share_text" in share_data:
                            share_data["share_text"] = fix_text(share_data["share_text"])
                        share_json = json.dumps(share_data)

                    # INSERT
                    cursor.execute(
                        """
                        INSERT OR IGNORE INTO messages 
                        (thread_id, sender_name, timestamp_ms, content, media_json, reactions_json, share_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                        (thread_id, sender, ts, content, media_json, reactions_json, share_json),
                    )

                    if cursor.rowcount > 0:
                        msg_count += 1
                    else:
                        skipped_count += 1

                    if ts >= last_activity_ms:
                        last_activity_ms = ts
                        if content:
                            latest_snippet = f"{sender}: {content}"
                        elif media:
                            # Simple media snippet
                            latest_snippet = f"{sender} sent a {media[0]['type']}"
                        else:
                            latest_snippet = f"{sender} sent a message"

        except Exception as e:
            print(f"Error reading {mf}: {e}")

    # Update thread with metadata
    cursor.execute(
        "UPDATE threads SET last_activity_ms = ?, snippet = ? WHERE id = ?",
        (last_activity_ms, latest_snippet, thread_id),
    )

    return msg_count, skipped_count


def ingest_google_chat_thread(cursor, thread_dir):
    """Ingests a single Google Chat thread folder."""
    thread_path = Path(thread_dir)
    thread_id = thread_path.name

    messages_file = thread_path / "messages.json"
    group_info_file = thread_path / "group_info.json"

    # Read Metadata
    title = ""
    participants = []

    if group_info_file.exists():
        try:
            with group_info_file.open("r", encoding="utf-8") as f:
                info = json.load(f)
                title = info.get("name", "")
                participants = [m.get("name", "Unknown") for m in info.get("members", [])]
        except Exception:
            pass

    # If no title, try to derive from participants (skip logic for now, UI can handle it)

    participants_json = json.dumps(normalize_participants(participants))
    is_group = True  # Google Chat exports are usually Groups or DMs (which are groups of 2)

    cursor.execute(
        """
        INSERT OR REPLACE INTO threads (id, platform, title, participants_json, is_group)
        VALUES (?, ?, ?, ?, ?)
    """,
        (thread_id, "google_chat", title, participants_json, is_group),
    )

    last_activity_ms = 0
    latest_snippet = ""
    skipped_count = 0

    # Read Messages
    # Google Chat usually has one big messages.json
    files_to_read = [messages_file] if messages_file.exists() else list(thread_path.glob("message_*.json"))

    # === Deduplicate attachments ===
    # 1. Scan disk for actual files
    disk_file_map = {}  # { base_filename: [(index, actual_filename), ...] }
    try:
        for f in thread_path.iterdir():
            if not f.is_file():
                continue
            if f.name == "messages.json" or f.name.startswith("message_") or f.name == "group_info.json":
                continue

            name_part = f.stem
            ext_part = f.suffix
            # Check for (N) pattern at end of name
            match = re.search(r"^(.*)\((\d+)\)$", name_part)
            if match:
                base_root = match.group(1)
                idx = int(match.group(2))
                base_filename = base_root + ext_part
            else:
                base_filename = f.name
                idx = 0

            if base_filename not in disk_file_map:
                disk_file_map[base_filename] = []
            disk_file_map[base_filename].append((idx, f.name))

        # Sort lists by index
        for base in disk_file_map:
            disk_file_map[base].sort(key=lambda x: x[0])

    except Exception as e:
        print(f"Warning scanning dir {thread_dir}: {e}")

    # 2. Collect all attachment references from ALL message files to get global counts
    all_messages = []
    for mf in files_to_read:
        try:
            with mf.open("r", encoding="utf-8") as f:
                data = json.load(f)
                msgs = data.get("messages", [])
                all_messages.extend(msgs)
        except Exception:
            pass

    # 3. Build JSON attachment map
    json_att_map = {}
    for msg in all_messages:
        if "attached_files" in msg:
            for attachment in msg["attached_files"]:
                ename = attachment.get("export_name")
                if ename:
                    if ename not in json_att_map:
                        json_att_map[ename] = []
                    json_att_map[ename].append(attachment)

    # 4. Resolve Filenames (Right-Alignment)
    for ename, att_list in json_att_map.items():
        candidates = disk_file_map.get(ename, [])
        if not candidates and "?" in ename:
            # Fallback: Google Takeout often replaces '?' with '?' with '_' in filenames
            sanitized = ename.replace("?", "_")
            candidates = disk_file_map.get(sanitized, [])

        offset = max(0, len(candidates) - len(att_list))

        for i, att in enumerate(att_list):
            disk_idx = offset + i
            if disk_idx < len(candidates):
                att["export_name"] = candidates[disk_idx][1]
            else:
                # Fallback logic for missing files
                p_ename = Path(ename)
                root = p_ename.stem
                ext = p_ename.suffix
                if disk_idx == 0:
                    # If we found a candidate via sanitized name earlier, we might want to use that?
                    # checks above ensure candidates is populated if found.
                    pass

                # If we are here, it means we ran out of candidates on disk
                # We'll just keep the original name or try to guess the (N) version
                if disk_idx > 0:
                    att["export_name"] = f"{root}({disk_idx}){ext}"
                elif candidates:
                    # If we had candidates but index is weirdly 0 (shouldn't happen with offset calc)
                    pass
                elif "?" in ename:
                    # If completely missing, at least ensure we write the sanitized version to DB
                    # so it doesn't break URL parsers
                    att["export_name"] = ename.replace("?", "_")

    # Now process the messages from memory (since we modified the attachment objects in place inside all_messages)

    msg_count = 0
    for m in all_messages:
        try:
            # Google Chat Schema Mapping
            sender = m.get("creator", {}).get("name", "Unknown")
            created_date = m.get("created_date", "")
            ts = parse_iso_time(created_date)
            content = fix_text(m.get("text", ""))  # Apply fix_text just in case

            # Annotations (Images/links/etc) are complex in Google Chat
            annotations = m.get("annotations", [])
            annotations_json = json.dumps(annotations) if annotations else None

            # Media extraction from attached_files
            media = []
            if "attached_files" in m:
                for att in m["attached_files"]:
                    export_name = att.get("export_name")
                    if export_name:
                        # Start with relative path assumption
                        uri = f"{thread_id}/{export_name}"
                        media.append({"uri": uri, "type": "file"})

            media_json = json.dumps(media) if media else None

            # Reactions
            reactions = []
            # Google chat reactions are top-level "reactions"
            if "reactions" in m:
                # [{"emoji": {"unicode": "X"}, "reactor_emails": ["a", "b"]}]
                for r in m["reactions"]:
                    emoji = r.get("emoji", {}).get("unicode", "")
                    for email in r.get("reactor_emails", []):
                        reactions.append({"reaction": emoji, "actor": email})

            reactions_json = json.dumps(reactions) if reactions else None

            # Quoted Message -> Map to share_json
            share_json = None
            if "quoted_message_metadata" in m:
                share_json = json.dumps({"quoted_message": m["quoted_message_metadata"]})

            cursor.execute(
                """
                INSERT OR IGNORE INTO messages 
                (thread_id, sender_name, timestamp_ms, content, media_json, reactions_json, share_json, annotations_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (thread_id, sender, ts, content, media_json, reactions_json, share_json, annotations_json),
            )

            if cursor.rowcount > 0:
                if ts >= last_activity_ms:
                    last_activity_ms = ts
                    if content:
                        latest_snippet = f"{sender}: {content}"
                    elif media:
                        # Simple media snippet
                        latest_snippet = f"{sender} sent a {media[0]['type']}"
                    else:
                        latest_snippet = f"{sender} sent a message"

                msg_count += 1
            else:
                skipped_count += 1

        except Exception as e:
            print(f"Error processing message in {thread_dir}: {e}")

    # Update thread metadata
    cursor.execute(
        "UPDATE threads SET last_activity_ms = ?, snippet = ? WHERE id = ?",
        (last_activity_ms, latest_snippet, thread_id),
    )

    return msg_count, skipped_count


# --- Main Scanner ---


def scan_directory(scan_path, db_path):
    """
    Recursively scans the provided directory for chat export data.

    It looks for folders containing 'message_1.json' or 'messages.json', identifying them as individual chat threads.
    It determines the platform (Facebook, Instagram, Google Chat) based on the parent folder names or contents.

    For each valid thread found:
      - It calls the appropriate platform ingestion function.
      - It tracks progress and commits to the database in batches.
      - It avoids re-processing the same directory if multiple JSON files exist within it.

    Args:
        scan_path (Path or str): The directory to search for chat data.
        db_path (Path or str): Path to the SQLite database file.
    """
    conn = sqlite3.connect(db_path)
    # Enable Write-Ahead Logging for concurrency during ingestion and subsequent reads
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    scan_path = Path(scan_path)
    print(f"Scanning {scan_path}...")

    total_threads = 0
    total_msgs = 0
    total_skipped = 0

    # We can rely on known root folder names or just look for message_1.json
    # Strategy: Find any folder containing 'message_1.json' or 'messages.json'
    # and try to determine platform from parent path.

    for file_path in scan_path.rglob("message*.json"):
        if file_path.name not in ["message_1.json", "messages.json"]:
            continue

        thread_dir = file_path.parent

        # Determine platform
        path_str = str(thread_dir).lower()

    # Python 3.12+ has Path.walk, but let's use os.walk below for compatibility
    processed_dirs = set()

    # Let's use os.walk for compat
    import os

    for root, dirs, files in os.walk(scan_path):
        if "message_1.json" in files or "messages.json" in files:
            p_root = Path(root)
            if p_root in processed_dirs:
                continue

            path_str = str(p_root).lower()

            count = 0
            skipped = 0

            if "google chat" in path_str:
                print(f"Ingesting Google Chat: {p_root.name}")
                count, skipped = ingest_google_chat_thread(cursor, p_root)
            elif "facebook" in path_str or "messenger" in path_str:
                print(f"Ingesting Facebook: {p_root.name}")
                count, skipped = ingest_facebook_instagram_thread(cursor, p_root, "facebook")
            elif "instagram" in path_str:
                print(f"Ingesting Instagram: {p_root.name}")
                count, skipped = ingest_facebook_instagram_thread(cursor, p_root, "instagram")

            if count > 0 or skipped > 0:
                total_threads += 1
                total_msgs += count
                total_skipped += skipped
                processed_dirs.add(p_root)
                if total_threads % 10 == 0:
                    conn.commit()
                    print(f"  ... Committed {total_threads} threads ({total_msgs} messages, {total_skipped} skipped)")

    conn.commit()
    conn.close()
    print(f"Done! Processed {total_threads} threads and {total_msgs} messages.")
    print(f"Skipped {total_skipped} duplicate messages.")


def extract_zips_found(search_dirs, target_root):
    """
    Scans specified directories for .zip files and extracts them
    into a subdirectory of target_root named after the zip file.
    Returns: tuple (processed_count, set_of_platforms_detected)
    """
    processed = 0
    target_root = Path(target_root)

    seen_zips = set()
    detected_platforms = set()

    for d in search_dirs:
        d_path = Path(d)
        if not d_path.exists():
            continue

        for zip_path in d_path.glob("*.zip"):
            # Avoid duplicates if DATA_DIR is inside PROJECT_ROOT (which it is)
            # resolve() helps
            abs_zip = zip_path.resolve()
            if abs_zip in seen_zips:
                continue
            seen_zips.add(abs_zip)

            print(f"Found zip archive: {zip_path.name}")

            # Determine destination based on filename to merge multi-part zips
            # and align with API expectations (DATA_DIR/Facebook, etc.)
            lower_name = zip_path.name.lower()
            if "facebook" in lower_name:
                dest_dir = target_root / "Facebook"
                detected_platforms.add("facebook")
            elif "instagram" in lower_name:
                dest_dir = target_root / "Instagram"
                detected_platforms.add("instagram")
            elif "google" in lower_name or "chat" in lower_name:
                dest_dir = target_root / "Google Chat"
                detected_platforms.add("google chat")
            else:
                # Fallback to separate folder if unknown
                dest_dir = target_root / zip_path.stem

            print(f"  Extracting to {dest_dir} ...")
            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(zip_path, "r") as zf:
                    zf.extractall(dest_dir)
                processed += 1
                print("  Extraction complete.")
            except Exception as e:
                print(f"  Error extracting {zip_path}: {e}")

    return processed, detected_platforms


def main():
    parser = argparse.ArgumentParser(description="Ingest MessageHub data into SQLite.")
    parser.add_argument("--source", type=str, help="Directory or Zip file to ingest (defaults to configured DATA_DIR)")
    parser.add_argument("--db", type=str, help="Database file path (defaults to DATA_DIR/messagehub.db)")
    args = parser.parse_args()

    # Defaults
    source_arg = args.source if args.source else str(DATA_DIR)
    db_arg = args.db if args.db else str(DATA_DIR / DB_NAME)

    db_path = Path(db_arg).resolve()
    init_db(db_path)

    source_path = Path(source_arg).resolve()

    # 1. Zip Scanning & Extraction
    # Scan project root and data dir for zips
    scan_locations = [PROJECT_ROOT, DATA_DIR]

    # If source path is a specific directory not in default list, add it
    if source_path.is_dir() and source_path not in scan_locations:
        scan_locations.append(source_path)

    _, detected_platforms = extract_zips_found(scan_locations, DATA_DIR)

    # 2. Ingestion
    if source_path.is_file() and source_path.suffix == ".zip":
        print("Zip extracted. Scanning full data directory to locate merged content...")
        scan_directory(DATA_DIR, db_path)

    elif source_path.is_dir():
        scan_directory(DATA_DIR, db_path)  # Scan the entire data dir (recursive) which now includes extracted zips
    else:
        print(f"Invalid source: {source_path}")

    # 3. Cleanup JSONs for non-Google platforms if zip extraction occurred
    # We clean up Facebook and Instagram to save space, but KEEP Google Chat (needed for media resolution).
    cleanup_targets = []
    if "facebook" in detected_platforms:
        cleanup_targets.append("facebook")
    if "instagram" in detected_platforms:
        cleanup_targets.append("instagram")

    if cleanup_targets:
        print("\n--- Cleanup ---")
        print(f"Sweeping JSON messages for: {', '.join(cleanup_targets)}")
        from utils import clean_json_messages

        clean_json_messages(DATA_DIR, platforms=cleanup_targets)


if __name__ == "__main__":
    main()
