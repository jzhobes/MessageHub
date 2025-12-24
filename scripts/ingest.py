import argparse
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Local parser imports
from parsers.facebook import (
    discover_facebook_identity,
    discover_instagram_identity,
    ingest_facebook_entry,
    ingest_instagram_entry,
)
from parsers.google_chat import discover_google_chat_identity, ingest_google_chat_thread
from parsers.google_mail import discover_google_mail_identity, ingest_google_mail_mbox
from parsers.google_voice import discover_google_voice_identity, ingest_google_voice
from utils import (
    PROJECT_ROOT,
    WORKSPACE_PATH,
    clean_google_voice_files,
    clean_json_messages,
    merge_folders,
)

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
    annotations_json TEXT,   -- JSON array: Google Chat annotations
    
    -- Constraint to prevent duplicates from overlapping exports
    UNIQUE(thread_id, sender_name, timestamp_ms, content)
);

-- Virtual Table for Full-Text Search
-- Using external content to keep DB size manageable
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id',
    tokenize='trigram'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TABLE IF NOT EXISTS identities (
    platform TEXT,
    id_type TEXT, -- 'email', 'name', 'id'
    id_value TEXT,
    is_me BOOLEAN DEFAULT 0,
    metadata_json TEXT, -- Optional: extra names, counts, etc.
    PRIMARY KEY (platform, id_type, id_value)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_messages_sender_name ON messages(sender_name);
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


def scan_directory(scan_path, db_path, platform_filter="all", limit_platforms=None):
    """
    Recursively scans the provided directory for chat export data.
    If limit_platforms is provided (a set), only those platforms will be scanned.
    """
    conn = sqlite3.connect(db_path)
    # Enable Write-Ahead Logging for concurrency during ingestion and subsequent reads
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    scan_path = Path(scan_path)
    print(f"Scanning {scan_path}...")

    # Explicitly check for Google Voice folder first (since it's structural, not recursive searching for message_1.json)
    process_voice = platform_filter == "all" or platform_filter == "google_voice"

    # Prepare sets for counting
    files_to_process = []

    # Count Google Voice folders if needed
    if process_voice:
        possible_voice_roots = [scan_path / "Voice", scan_path / "Takeout/Voice", scan_path]
        for p in possible_voice_roots:
            calls_dir = p / "Calls"
            if calls_dir.exists():
                # Filter check
                if limit_platforms is not None and "google_voice" not in limit_platforms:
                    continue

                # Google Voice is structurally one "item" acting as a bulk ingest,
                # but we can count it as 1 major task.
                files_to_process.append((999, p, "google_voice"))  # 999 as placeholder priority
                break

    # Count MBOX files for Google Mail
    process_mail = platform_filter == "all" or platform_filter == "google_mail"
    if process_mail:
        possible_mail_roots = [scan_path / "Mail", scan_path / "Takeout/Mail", scan_path]
        for p in possible_mail_roots:
            mboxes = list(p.glob("*.mbox"))
            for mbox in mboxes:
                if limit_platforms is not None and "google_mail" not in limit_platforms:
                    continue
                files_to_process.append((10, mbox, "google_mail"))

    # Count Standard Chat Files
    for root, dirs, files in os.walk(scan_path):
        p_root = Path(root)
        path_str = str(p_root).lower()

        # Check for message markers
        if "message_1.json" not in files and "messages.json" not in files:
            continue

        # Platform detection mapping
        platform_map = {
            "google chat": "google_chat",
            "facebook": "facebook",
            "messenger": "facebook",
            "instagram": "instagram",
        }

        detected_platform = next((v for k, v in platform_map.items() if k in path_str), None)
        if not detected_platform:
            continue

        # Platform filtering
        if platform_filter != "all" and platform_filter != detected_platform:
            continue
        if limit_platforms is not None and detected_platform not in limit_platforms:
            continue

        # Add to work queue with arbitrary but consistent priority
        priority_map = {"google_chat": 1, "facebook": 2, "instagram": 3}
        files_to_process.append((priority_map[detected_platform], p_root, detected_platform))

    total_files_count = len(files_to_process)
    print(f"[TotalFiles]: {total_files_count}")  # Signal for UI

    # Initialize counters
    total_threads = 0
    total_msgs = 0
    total_skipped = 0
    processed_dirs = set()

    # Identity tracking
    gmail_identity_stats = {}
    discovered_identities = set()

    for _, p_root, platform_type in files_to_process:
        if p_root in processed_dirs:
            continue

        count = 0
        skipped = 0

        if platform_type == "google_voice":
            if "google_voice" not in discovered_identities:
                gv_name = discover_google_voice_identity(scan_path)
                if gv_name:
                    print(f"[Identity]: Discovered Google Voice number as {gv_name}")
                    save_identity(cursor, "google_voice", "name", gv_name, is_me=True)
                discovered_identities.add("google_voice")
            print(f"[Ingesting]: Google Voice - {p_root.name}")
            count, skipped = ingest_google_voice(cursor, p_root)

        elif platform_type == "google_chat":
            if "google_chat" not in discovered_identities:
                gc_name = discover_google_chat_identity(scan_path)
                if gc_name:
                    print(f"[Identity]: Discovered Google Chat owner as {gc_name}")
                    save_identity(cursor, "google_chat", "name", gc_name, is_me=True)
                discovered_identities.add("google_chat")
            print(f"[Ingesting]: Google Chat - {p_root.name}")
            count, skipped = ingest_google_chat_thread(cursor, p_root)

        elif platform_type == "facebook":
            if "facebook" not in discovered_identities:
                fb_name = discover_facebook_identity(scan_path)
                if fb_name:
                    print(f"[Identity]: Discovered Facebook owner as {fb_name}")
                    save_identity(cursor, "facebook", "name", fb_name, is_me=True)
                discovered_identities.add("facebook")
            print(f"[Ingesting]: Facebook - {p_root.name}")
            count, skipped = ingest_facebook_entry(cursor, p_root)

        elif platform_type == "instagram":
            if "instagram" not in discovered_identities:
                ig_name = discover_instagram_identity(scan_path)
                if ig_name:
                    print(f"[Identity]: Discovered Instagram owner as {ig_name}")
                    save_identity(cursor, "instagram", "name", ig_name, is_me=True)
                discovered_identities.add("instagram")
            print(f"[Ingesting]: Instagram - {p_root.name}")
            count, skipped = ingest_instagram_entry(cursor, p_root)

        elif platform_type == "google_mail":
            print(f"[Ingesting]: Google Mail - {p_root.name}")
            count, skipped = ingest_google_mail_mbox(cursor, p_root, gmail_identity_stats)

        if count > 0 or skipped > 0:
            total_threads += 1
            total_msgs += count
            total_skipped += skipped
            processed_dirs.add(p_root)
            if total_threads % 10 == 0:
                conn.commit()
                print(f"  [Committed]: {total_threads} threads ({total_msgs} messages, {total_skipped} skipped)")

    # Finalize identities
    if gmail_identity_stats:
        finalize_gmail_identity(cursor, gmail_identity_stats)

    conn.close()
    print(f"Done! Processed {total_threads} standard threads and {total_msgs} messages.")
    print(f"Skipped {total_skipped} duplicate messages.")


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


def extract_zips_found(search_dirs, target_root, platform_filter="all"):
    """
    Scans specified directories for .zip files and extracts them
    into a subdirectory of target_root named after the zip file.
    Returns: tuple (processed_count, set_of_platforms_detected, archive_moves)
    archive_moves: list of (original_Path, processed_Path)
    """
    return extract_zips_found_with_opts(search_dirs, target_root, platform_filter, False)


def extract_zips_found_with_opts(search_dirs, target_root, platform_filter="all", delete_after=False):
    """
    Scans specified directories for .zip files and extracts them
    into a subdirectory of target_root named after the zip file.
    Returns: tuple (processed_count, set_of_platforms_detected, archive_moves)
    archive_moves: list of (original_Path, processed_Path_or_None)
    """
    processed = 0
    target_root = Path(target_root)
    archive_moves = []
    extraction_lock = threading.Lock()

    seen_zips = set()
    detected_platforms = set()

    # Collect all archives first
    all_archives = []
    for d in search_dirs:
        d_path = Path(d)
        if not d_path.exists():
            continue
        archives = list(d_path.glob("*.zip")) + list(d_path.glob("*.tgz")) + list(d_path.glob("*.tar.gz"))
        for a in archives:
            if a.resolve() not in seen_zips:
                seen_zips.add(a.resolve())
                all_archives.append(a)

    if not all_archives:
        return 0, set(), []

    def process_archive(archive_path):
        """
        Worker function to extract a single archive.
        Returns (success_bool, detected_platform_string_or_None)
        """
        local_detected = set()
        is_zip = archive_path.suffix == ".zip"
        is_tar = archive_path.name.endswith(".tar.gz") or archive_path.name.endswith(".tgz")

        try:
            file_list = []

            # Open Archive
            if is_zip:
                archive_obj = zipfile.ZipFile(archive_path, "r")
                file_list = archive_obj.namelist()
            elif is_tar:
                archive_obj = tarfile.open(archive_path, "r:gz")
                file_list = archive_obj.getnames()
            else:
                return False, None, None

            # signatures
            has_voice = any(f.startswith("Takeout/Voice/") for f in file_list)
            has_chat = any(f.startswith("Takeout/Google Chat/") for f in file_list)
            has_mail = any(f.startswith("Takeout/Mail/") for f in file_list)
            is_insta = any(f.startswith("your_instagram_activity") for f in file_list)
            is_fb = any(f.startswith("your_facebook_activity") for f in file_list)

            # Filter Check
            if platform_filter != "all":
                allowed = False
                if platform_filter == "google_voice" and has_voice:
                    allowed = True
                if platform_filter == "google_chat" and has_chat:
                    allowed = True
                if platform_filter == "google_mail" and has_mail:
                    allowed = True
                if platform_filter == "instagram" and is_insta:
                    allowed = True
                if platform_filter == "facebook" and is_fb:
                    allowed = True

                if not allowed:
                    print(f"  Skipping {archive_path.name}: Filter mismatch.")
                    if is_zip:
                        archive_obj.close()
                    elif is_tar:
                        archive_obj.close()
                    return False, None, None

            # Extract
            dest_dir = target_root
            if is_insta:
                dest_dir = target_root / "Instagram"
            if is_fb:
                dest_dir = target_root / "Facebook"

            # Identification Logging
            if has_voice or has_chat or has_mail:
                print(f"  [Thread] Extracting Google Takeout: {archive_path.name}")
                if has_voice:
                    local_detected.add("google_voice")
                if has_chat:
                    local_detected.add("google_chat")
                if has_mail:
                    local_detected.add("google_mail")
            elif is_insta:
                print(f"  [Thread] Extracting Instagram: {archive_path.name}")
                local_detected.add("instagram")
            elif is_fb:
                print(f"  [Thread] Extracting Facebook: {archive_path.name}")
                local_detected.add("facebook")
            else:
                print(f"  Skipping {archive_path.name}: Unknown structure.")
                if is_zip:
                    archive_obj.close()
                elif is_tar:
                    archive_obj.close()
                return False, None, None

            # Prepare destination directory (Locked)
            with extraction_lock:
                if not dest_dir.exists():
                    dest_dir.mkdir(parents=True, exist_ok=True)
                elif dest_dir.is_file():
                    print(f"  [Error] Cannot extract to {dest_dir}: file already exists with this name.")
                    return False, None, None

            # Perform Extraction (Unlocked for Parallelism)
            members = archive_obj.namelist() if is_zip else archive_obj.getmembers()
            total_members = len(members)
            print(f"[ArchiveStarted]: {archive_path.name}|{total_members}")
            for i, member in enumerate(members):
                try:
                    archive_obj.extract(member, dest_dir)
                    if (i + 1) % 50 == 0 or (i + 1) == total_members:
                        print(f"[ArchiveProgress]: {archive_path.name}|{i + 1}|{total_members}")
                except Exception as e:
                    print(f"  Warning: Failed to extract {member} from {archive_path.name}: {e}")

            if is_zip:
                archive_obj.close()
            elif is_tar:
                archive_obj.close()

            print(f"[ArchiveExtracted]: {archive_path.name}")

            # Post-Processing: Move archive to .processed
            try:
                with extraction_lock:
                    processed_dir = target_root / ".processed"
                    os.makedirs(processed_dir, exist_ok=True)

                    destination = processed_dir / archive_path.name
                    if destination.exists():
                        timestamp = int(time.time() * 1000)
                        destination = processed_dir / f"{archive_path.stem}_{timestamp}{archive_path.suffix}"

                    # Double check archive still exists (might have been moved by another thread if somehow duplicated)
                    if not archive_path.exists():
                        return True, local_detected, None

                    if delete_after:
                        archive_path.unlink()
                        print(f"  [Post] Deleted archive: {archive_path.name}")
                        return True, local_detected, (archive_path, None)
                    else:
                        shutil.move(str(archive_path), str(destination))
                        return True, local_detected, (archive_path, destination)
                return True, local_detected, (archive_path, destination)
            except Exception as e:
                print(f"  Warning: Move/Delete failed for {archive_path.name}: {e}")
                return True, local_detected, None

        except Exception as e:
            print(f"  Error processing {archive_path.name}: {e}")
            return False, None, None

    # Run Parallel
    # Limit workers to avoid disk thrashing, but beneficial for decompression
    max_workers = min(4, len(all_archives))
    print(f"Starting extraction of {len(all_archives)} archives...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(process_archive, a) for a in all_archives]
        for future in as_completed(futures):
            success, platforms, move_info = future.result()
            if success:
                processed += 1
                if platforms:
                    detected_platforms.update(platforms)
                if move_info:
                    archive_moves.append(move_info)

    # Post-Extraction Structural Cleanup (Sequential)
    # Now that all zips are extracted, we can safely move the Takeout folders
    # without fear of race conditions from other threads writing to them.

    # Google Voice
    if "google_voice" in detected_platforms:
        src = target_root / "Takeout" / "Voice"
        dst = target_root / "Voice"
        if src.exists():
            print("  Consolidating Google Voice data...")
            merge_folders(src, dst)

    # Google Chat
    if "google_chat" in detected_platforms:
        src = target_root / "Takeout" / "Google Chat"
        dst = target_root / "Google Chat"
        if src.exists():
            print("  Consolidating Google Chat data...")
            merge_folders(src, dst)

    # Google Mail
    if "google_mail" in detected_platforms:
        src = target_root / "Takeout" / "Mail"
        dst = target_root / "Mail"
        if src.exists():
            print("  Consolidating Google Mail data...")
            merge_folders(src, dst)

    # Final cleanup: remove empty Takeout folder
    takeout_root = target_root / "Takeout"
    if takeout_root.exists() and not any(takeout_root.iterdir()):
        try:
            takeout_root.rmdir()
            print("Removed empty Takeout folder.")
        except Exception:
            pass

    return processed, detected_platforms, archive_moves


def start_ingestion():
    parser = argparse.ArgumentParser(description="Ingest MessageHub data into SQLite.")
    parser.add_argument(
        "--source", type=str, help="Directory or Zip file to ingest (defaults to configured WORKSPACE_PATH)"
    )
    parser.add_argument("--db", type=str, help="Database file path (defaults to WORKSPACE_PATH/messagehub.db)")
    parser.add_argument(
        "--platform",
        choices=["all", "facebook", "instagram", "google_chat", "google_voice", "google_mail"],
        default="all",
        help="Target specific platform",
    )
    parser.add_argument(
        "--delete-archives",
        action="store_true",
        help="Delete archives after successful extraction (no .processed folder)",
    )
    args = parser.parse_args()

    # Defaults
    source_arg = args.source if args.source else str(WORKSPACE_PATH)
    db_arg = args.db if args.db else str(WORKSPACE_PATH / DB_NAME)

    db_path = Path(db_arg).resolve()
    init_db(db_path)

    source_path = Path(source_arg).resolve()

    # Zip Scanning & Extraction
    detected_platforms = set()

    # Scan project root and data dir for zips
    scan_locations = [PROJECT_ROOT, WORKSPACE_PATH]

    # If source path is a specific directory not in default list, add it
    if source_path.is_dir() and source_path not in scan_locations:
        scan_locations.append(source_path)

    # Pre-count archives for progress UI
    total_archives = 0
    seen_zips_count = set()
    for d in scan_locations:
        d_path = Path(d)
        if not d_path.exists():
            continue
        archives = list(d_path.glob("*.zip")) + list(d_path.glob("*.tgz")) + list(d_path.glob("*.tar.gz"))
        for a in archives:
            if a.resolve() not in seen_zips_count:
                seen_zips_count.add(a.resolve())
                total_archives += 1

    print(f"[TotalArchives]: {total_archives}")  # Signal for UI

    # Disk Space Check
    if total_archives > 0:
        total_archive_size = sum(a.stat().st_size for a in seen_zips_count)
        # Requirement estimate: Extraction (~2x) + DB/Overhead (~0.5x)
        required_bytes = total_archive_size * 2.5

        try:
            _, _, free_bytes = shutil.disk_usage(WORKSPACE_PATH)
            if free_bytes < required_bytes:
                req_gb = required_bytes / (1024**3)
                free_gb = free_bytes / (1024**3)
                print(
                    f"[Error]: Insufficient disk space. Estimated requirement: {req_gb:.2f} GB, Free: {free_gb:.2f} GB"
                )
                sys.exit(1)
        except Exception as e:
            print(f"  Warning: Could not verify disk space: {e}")

    processed_count, detected_platforms, archive_moves = extract_zips_found_with_opts(
        scan_locations, WORKSPACE_PATH, args.platform, args.delete_archives
    )

    try:
        # Ingestion
        if processed_count > 0:
            print(
                f"Archives processed ({processed_count}). Scanning workspace for {', '.join(detected_platforms)} content..."
            )
            scan_directory(WORKSPACE_PATH, db_path, platform_filter=args.platform, limit_platforms=detected_platforms)
        elif source_path.is_file() and source_path.suffix == ".zip":
            # Direct zip path support (treat as 'all' because we didn't use extract_zips_found_with_opts to get detected set)
            print("Specified zip extracted. Scanning for content...")
            scan_directory(WORKSPACE_PATH, db_path, platform_filter=args.platform)
        elif source_path.is_dir() and any(seen_zips_count):
            # If we had zips but processed_count was 0? (Shouldn't happen with our logic but being safe)
            scan_directory(WORKSPACE_PATH, db_path, platform_filter=args.platform, limit_platforms=detected_platforms)
        else:
            # If a source was explicitly provided but no archives found, we should still scan it
            print(f"No new archives found. Scanning {source_arg} for existing content...")
            scan_directory(source_path, db_path, platform_filter=args.platform)

        # Cleanup JSONs for non-Google platforms
        cleanup_targets = []

        # If we extracted specific platforms, clean them
        if "facebook" in detected_platforms:
            cleanup_targets.append("facebook")
        if "instagram" in detected_platforms:
            cleanup_targets.append("instagram")
        if "google_chat" in detected_platforms:
            cleanup_targets.append("google_chat")

        print("\n--- Cleanup ---")

        # JSON Cleanup (Facebook/Insta)
        if cleanup_targets:
            print(f"Sweeping JSON messages for: {', '.join(cleanup_targets)}")
            clean_json_messages(WORKSPACE_PATH, platforms=cleanup_targets)

        # Google Voice Cleanup
        if "google_voice" in detected_platforms:
            clean_google_voice_files(WORKSPACE_PATH)

    except Exception as e:
        print(f"\n[Error]: Ingestion failed unexpectedly: {e}")
        if archive_moves:
            print(f"Rolling back {len(archive_moves)} archive moves...")
            for original, processed in archive_moves:
                if processed and processed.exists():
                    try:
                        shutil.move(str(processed), str(original))
                        print(f"  Restored {original.name}")
                    except Exception as re:
                        print(f"  Failed to restore {original.name}: {re}")
        sys.exit(1)


if __name__ == "__main__":
    start_ingestion()
