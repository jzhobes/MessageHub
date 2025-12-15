import sqlite3
import argparse
import zipfile
from pathlib import Path

# External dependencies (assumes venv is active)
# (BeautifulSoup import removed as it is now used in parsers, not here)

from utils import DATA_DIR, PROJECT_ROOT, merge_folders
from parsers.google_voice import scan_google_voice
from parsers.facebook import ingest_facebook_entry, ingest_instagram_entry
from parsers.google_chat import ingest_google_chat_thread

# --- Constants ---
DB_NAME = "messagehub.db"


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


# --- Main Scanner ---


def scan_directory(scan_path, db_path, platform_filter="all"):
    """
    Recursively scans the provided directory for chat export data.
    """
    conn = sqlite3.connect(db_path)
    # Enable Write-Ahead Logging for concurrency during ingestion and subsequent reads
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    scan_path = Path(scan_path)
    print(f"Scanning {scan_path}...")

    # Explicitly check for Google Voice folder first (since it's structural, not recursive searching for message_1.json)
    # We look for "Voice/Calls" usually relative to data root
    # Check scan_path/Voice, and scan_path (if it IS Voice)

    # Check filter
    process_voice = platform_filter == "all" or platform_filter == "google_voice"

    if process_voice:
        possible_voice_roots = [scan_path / "Voice", scan_path / "Takeout/Voice", scan_path]
        for p in possible_voice_roots:
            if (p / "Calls").exists():
                scan_google_voice(cursor, p)
                break

    total_threads = 0
    total_msgs = 0
    total_skipped = 0

    # For standard platforms (FB/Insta/Google Chat)
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

            # Skip if accidentally inside Google Voice (though GV doesn't use message_1.json usually)

            # --- Platform Filtering ---
            # Helper to check if current path matches requested platform
            # We check path string vs platform keywords

            is_chat = "google chat" in path_str
            is_fb = "facebook" in path_str or "messenger" in path_str
            is_insta = "instagram" in path_str

            if platform_filter != "all":
                if platform_filter == "google_chat" and not is_chat:
                    continue
                if platform_filter == "facebook" and not is_fb:
                    continue
                if platform_filter == "instagram" and not is_insta:
                    continue
                # if platform_filter is google_voice, skip all these folders as they are processed separately above
                if platform_filter == "google_voice":
                    continue

            if is_chat:
                print(f"Ingesting Google Chat: {p_root.name}")
                count, skipped = ingest_google_chat_thread(cursor, p_root)
            elif is_fb:
                print(f"Ingesting Facebook: {p_root.name}")
                count, skipped = ingest_facebook_entry(cursor, p_root)
            elif is_insta:
                print(f"Ingesting Instagram: {p_root.name}")
                count, skipped = ingest_instagram_entry(cursor, p_root)

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
    print(f"Done! Processed {total_threads} standard threads and {total_msgs} messages.")
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

            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    file_list = zf.namelist()
                    is_processed = False

                    # Check for signatures
                    # 1. Google Takeout (Voice/Chat)
                    has_voice = any(f.startswith("Takeout/Voice/") for f in file_list)
                    has_chat = any(f.startswith("Takeout/Google Chat/") for f in file_list)

                    if has_voice or has_chat:
                        dest_dir = target_root
                        if has_voice:
                            detected_platforms.add("google_voice")
                        if has_chat:
                            detected_platforms.add("google_chat")

                        print(
                            f"  Identified as Google Takeout (Voice={has_voice}, Chat={has_chat}). Extracting to {dest_dir} ..."
                        )
                        zf.extractall(dest_dir)

                        # Flatten structure: Merge Takeout/* -> *
                        # e.g. Takeout/Voice -> Voice
                        if has_voice:
                            src = dest_dir / "Takeout" / "Voice"
                            dst = dest_dir / "Voice"
                            if src.exists():
                                merge_folders(src, dst)

                        if has_chat:
                            src = dest_dir / "Takeout" / "Google Chat"
                            dst = dest_dir / "Google Chat"
                            if src.exists():
                                merge_folders(src, dst)

                        # Try to remove empty Takeout folder
                        try:
                            takeout_root = dest_dir / "Takeout"
                            if takeout_root.exists() and not any(takeout_root.iterdir()):
                                takeout_root.rmdir()
                        except Exception:
                            pass

                        is_processed = True

                    # 2. Instagram signature: your_instagram_activity
                    elif any(f.startswith("your_instagram_activity") for f in file_list):
                        dest_dir = target_root / "Instagram"
                        detected_platforms.add("instagram")
                        print(f"  Identified as Instagram Export. Extracting to {dest_dir} ...")
                        zf.extractall(dest_dir)
                        is_processed = True

                    # 3. Facebook signature: your_activity_across_facebook
                    elif any(f.startswith("your_facebook_activity") for f in file_list):
                        dest_dir = target_root / "Facebook"
                        detected_platforms.add("facebook")
                        print(f"  Identified as Facebook Export. Extracting to {dest_dir} ...")
                        zf.extractall(dest_dir)
                        is_processed = True

                    if is_processed:
                        processed += 1
                        print("  Extraction complete.")
                    else:
                        print(f"  Skipping {zip_path.name}: Could not identify platform structure.")

            except Exception as e:
                print(f"  Error inspecting/extracting {zip_path.name}: {e}")

    return processed, detected_platforms


def start_ingestion():
    parser = argparse.ArgumentParser(description="Ingest MessageHub data into SQLite.")
    parser.add_argument("--source", type=str, help="Directory or Zip file to ingest (defaults to configured DATA_DIR)")
    parser.add_argument("--db", type=str, help="Database file path (defaults to DATA_DIR/messagehub.db)")
    parser.add_argument("--skip-unzip", action="store_true", help="Skip zip extraction step")
    parser.add_argument(
        "--platform",
        choices=["all", "facebook", "instagram", "google_chat", "google_voice"],
        default="all",
        help="Target specific platform",
    )
    args = parser.parse_args()

    # Defaults
    source_arg = args.source if args.source else str(DATA_DIR)
    db_arg = args.db if args.db else str(DATA_DIR / DB_NAME)

    db_path = Path(db_arg).resolve()
    init_db(db_path)

    source_path = Path(source_arg).resolve()

    # 1. Zip Scanning & Extraction
    detected_platforms = set()
    if not args.skip_unzip:
        # Scan project root and data dir for zips
        scan_locations = [PROJECT_ROOT, DATA_DIR]

        # If source path is a specific directory not in default list, add it
        if source_path.is_dir() and source_path not in scan_locations:
            scan_locations.append(source_path)

        _, detected_platforms = extract_zips_found(scan_locations, DATA_DIR)
    else:
        print("Skipping zip extraction.")

    # 2. Ingestion
    if source_path.is_file() and source_path.suffix == ".zip":
        print("Zip extracted. Scanning full data directory to locate merged content...")
        scan_directory(DATA_DIR, db_path, platform_filter=args.platform)

    elif source_path.is_dir():
        # Scan the entire data dir (recursive) which now includes extracted zips
        scan_directory(DATA_DIR, db_path, platform_filter=args.platform)
    else:
        print(f"Invalid source: {source_path}")

    # 3. Cleanup JSONs for non-Google platforms (only if we just extracted them, for safety)
    # If the user skipped unzip, they might not want cleanup either, or maybe they do.
    # For now let's assume cleanup is tied to extraction event or explicit platform
    cleanup_targets = []

    # If we extracted specific platforms, clean them
    if "facebook" in detected_platforms:
        cleanup_targets.append("facebook")
    if "instagram" in detected_platforms:
        cleanup_targets.append("instagram")

    # If using platform filter, maybe clean those? Best to stick to "cleanup whatever we just extracted"
    # to avoid deleting files the user might be managing manually if skipping unzip.

    if not args.skip_unzip:
        print("\n--- Cleanup ---")

        # 1. JSON Cleanup (Facebook/Insta)
        if cleanup_targets:
            print(f"Sweeping JSON messages for: {', '.join(cleanup_targets)}")
            from utils import clean_json_messages

            clean_json_messages(DATA_DIR, platforms=cleanup_targets)

        # 2. Google Voice Cleanup
        if "google_voice" in detected_platforms:
            from utils import clean_google_voice_files

            clean_google_voice_files(DATA_DIR)


if __name__ == "__main__":
    start_ingestion()
