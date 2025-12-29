import argparse
import os
import shutil
import sys
from pathlib import Path

# Local library imports
from lib.archives import extract_archives_found_with_opts
from lib.db_ops import finalize_gmail_identity, get_db_connection, init_db, save_identity

# Local parser imports
from parsers.facebook import (
    discover_facebook_identity,
    discover_instagram_identity,
    ingest_facebook_checkins,
    ingest_facebook_entry,
    ingest_facebook_events,
    ingest_facebook_owned_events,
    ingest_facebook_posts,
    ingest_instagram_entry,
)
from parsers.google_chat import discover_google_chat_identity, ingest_google_chat_thread
from parsers.google_mail import ingest_google_mail_mbox
from parsers.google_voice import discover_google_voice_identity, ingest_google_voice
from utils import (
    PROJECT_ROOT,
    WORKSPACE_PATH,
    clean_google_mail_files,
    clean_google_voice_files,
    clean_json_messages,
)

# --- Constants ---
DB_NAME = "messagehub.db"


# --- Platform Handlers ---
def handle_google_voice(cursor, p_root, scan_path, discovered_identities):
    if "google_voice" not in discovered_identities:
        gv_name = discover_google_voice_identity(scan_path)
        if gv_name:
            print(f"[Identity]: Discovered Google Voice number as {gv_name}")
            save_identity(cursor, "google_voice", "name", gv_name, is_me=True)
        discovered_identities.add("google_voice")
    print(f"[Ingesting]: Google Voice - {p_root.name}")
    return ingest_google_voice(cursor, p_root)


def handle_google_chat(cursor, p_root, scan_path, discovered_identities):
    if "google_chat" not in discovered_identities:
        gc_name = discover_google_chat_identity(scan_path)
        if gc_name:
            print(f"[Identity]: Discovered Google Chat owner as {gc_name}")
            save_identity(cursor, "google_chat", "name", gc_name, is_me=True)
        discovered_identities.add("google_chat")
    print(f"[Ingesting]: Google Chat - {p_root.name}")
    return ingest_google_chat_thread(cursor, p_root)


def handle_facebook(cursor, p_root, scan_path, discovered_identities):
    if "facebook" not in discovered_identities:
        fb_name = discover_facebook_identity(scan_path)
        if fb_name:
            print(f"[Identity]: Discovered Facebook owner as {fb_name}")
            save_identity(cursor, "facebook", "name", fb_name, is_me=True)
        discovered_identities.add("facebook")

    print(f"[Ingesting]: Facebook - {p_root.name}")
    count, skipped = ingest_facebook_entry(cursor, p_root)

    # Special activity ingestion (once per scan)
    facebook_workspace = scan_path / "Facebook"
    if facebook_workspace.exists() and "facebook_activity" not in discovered_identities:
        print("[Ingesting]: Facebook Social Activity (Events, Posts, Check-ins)...")
        my_full_name = discover_facebook_identity(scan_path)

        # Cleanup legacy hashed IDs to prevent "doubles"
        print("  Cleaning up legacy social activity records...")
        for prefix in ["fb_event_", "fb_post_", "fb_ci_"]:
            # Delete threads that follow the old pattern: prefix + timestamp + _ + hash
            # New pattern is just prefix + timestamp
            cursor.execute(f"SELECT id FROM threads WHERE id LIKE '{prefix}%' AND id GLOB '{prefix}*[0-9]_*'")
            legacy_ids = [row[0] for row in cursor.fetchall()]
            if legacy_ids:
                placeholders = ",".join(["?"] * len(legacy_ids))
                cursor.execute(f"DELETE FROM content WHERE thread_id IN ({placeholders})", legacy_ids)
                cursor.execute(f"DELETE FROM threads WHERE id IN ({placeholders})", legacy_ids)
                # Labels will cascade if foreign keys are active, but safe to do manually
                cursor.execute(f"DELETE FROM thread_labels WHERE thread_id IN ({placeholders})", legacy_ids)

        ec, es = ingest_facebook_events(cursor, scan_path, my_full_name)
        oc, os = ingest_facebook_owned_events(cursor, scan_path, my_full_name)
        pc, ps = ingest_facebook_posts(cursor, scan_path, my_full_name)
        cc, cs = ingest_facebook_checkins(cursor, scan_path, my_full_name)

        count += ec + oc + pc + cc
        skipped += es + os + ps + cs
        discovered_identities.add("facebook_activity")

    return count, skipped


def handle_instagram(cursor, p_root, scan_path, discovered_identities):
    if "instagram" not in discovered_identities:
        ig_name = discover_instagram_identity(scan_path)
        if ig_name:
            print(f"[Identity]: Discovered Instagram owner as {ig_name}")
            save_identity(cursor, "instagram", "name", ig_name, is_me=True)
        discovered_identities.add("instagram")
    print(f"[Ingesting]: Instagram - {p_root.name}")
    return ingest_instagram_entry(cursor, p_root)


def handle_google_mail(cursor, p_root, scan_path, discovered_identities, gmail_identity_stats):
    print(f"[Ingesting]: Google Mail - {p_root.name}")
    return ingest_google_mail_mbox(cursor, p_root, gmail_identity_stats)


PLATFORM_HANDLERS = {
    "google_voice": handle_google_voice,
    "google_chat": handle_google_chat,
    "facebook": handle_facebook,
    "instagram": handle_instagram,
}


# --- Core Ingestion Logic ---
def scan_directory(scan_path, db_path, platform_filter="all", limit_platforms=None):
    """Recursively scans the provided directory for chat export data."""
    conn = get_db_connection(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    cursor = conn.cursor()

    scan_path = Path(scan_path)
    print(f"Scanning {scan_path}...")

    files_to_process = []

    # 1. Google Voice check (structural)
    if platform_filter in ("all", "google_voice"):
        possible_roots = [scan_path / "Voice", scan_path / "Takeout/Voice", scan_path]
        for p in possible_roots:
            if (p / "Calls").exists():
                if limit_platforms is None or "google_voice" in limit_platforms:
                    files_to_process.append((999, p, "google_voice"))
                    break

    # 2. Google Mail check (mbox)
    if platform_filter in ("all", "google_mail"):
        possible_roots = [scan_path / "Mail", scan_path / "Takeout/Mail", scan_path]
        for p in possible_roots:
            for mbox in p.glob("*.mbox"):
                if limit_platforms is None or "google_mail" in limit_platforms:
                    files_to_process.append((10, mbox, "google_mail"))

    # 3. Recursive check for standard chat platforms
    platform_map = {
        "google chat": "google_chat",
        "facebook": "facebook",
        "messenger": "facebook",
        "instagram": "instagram",
    }
    priority_map = {"google_chat": 1, "facebook": 2, "instagram": 3}

    for root, _, files in os.walk(scan_path):
        # Look for message threads OR identity files
        if not any(
            f in files
            for f in [
                "message_1.json",
                "messages.json",
                "profile_information.json",
                "personal_information.json",
                "user_info.json",
            ]
        ):
            continue

        p_root = Path(root)
        path_str = str(p_root).lower()
        detected = next((v for k, v in platform_map.items() if k in path_str), None)

        if not detected:
            continue
        if platform_filter != "all" and platform_filter != detected:
            continue
        if limit_platforms is not None and detected not in limit_platforms:
            continue

        files_to_process.append((priority_map.get(detected, 50), p_root, detected))

    # Ingestion Loop
    print(f"[TotalFiles]: {len(files_to_process)}")
    total_threads, total_msgs, total_skipped = 0, 0, 0
    processed_dirs = set()
    gmail_identity_stats = {}
    discovered_identities = set()

    for _, p_root, platform_type in files_to_process:
        if p_root in processed_dirs:
            continue

        if platform_type == "google_mail":
            count, skipped = handle_google_mail(cursor, p_root, scan_path, discovered_identities, gmail_identity_stats)
        else:
            handler = PLATFORM_HANDLERS.get(platform_type)
            if handler:
                count, skipped = handler(cursor, p_root, scan_path, discovered_identities)
            else:
                continue

        if count > 0 or skipped > 0:
            total_threads += 1
            total_msgs += count
            total_skipped += skipped
            processed_dirs.add(p_root)
            if total_threads % 10 == 0:
                conn.commit()
                print(f"  [Committed]: {total_threads} threads ({total_msgs} messages, {total_skipped} skipped)")

    if gmail_identity_stats:
        finalize_gmail_identity(cursor, gmail_identity_stats)

    conn.commit()
    conn.close()
    print(f"Done! Processed {total_threads} threads and {total_msgs} messages.")


# --- Main Entry Point ---
def start_ingestion():
    parser = argparse.ArgumentParser(description="Ingest MessageHub data into SQLite.")
    parser.add_argument("--source", type=str, help="Source Directory or Zip (defaults to WORKSPACE_PATH)")
    parser.add_argument("--db", type=str, help="DB path (defaults to WORKSPACE_PATH/messagehub.db)")
    parser.add_argument(
        "--platform",
        choices=["all", "facebook", "instagram", "google_chat", "google_voice", "google_mail"],
        default="all",
    )
    parser.add_argument("--delete-archives", action="store_true", help="Delete ZIPs after extraction")
    args = parser.parse_args()

    # Setup Paths
    source_path = Path(args.source if args.source else WORKSPACE_PATH).resolve()
    db_path = Path(args.db if args.db else WORKSPACE_PATH / DB_NAME).resolve()
    init_db(db_path)

    # Archive Management
    scan_locations = [PROJECT_ROOT, WORKSPACE_PATH]
    if source_path.is_dir() and source_path not in scan_locations:
        scan_locations.append(source_path)

    all_archives = []
    for loc in scan_locations:
        if loc.exists():
            all_archives.extend(list(loc.glob("*.zip")) + list(loc.glob("*.tgz")) + list(loc.glob("*.tar.gz")))

    unique_archives = list({a.resolve() for a in all_archives})
    print(f"[TotalArchives]: {len(unique_archives)}")

    if unique_archives:
        total_size = sum(a.stat().st_size for a in unique_archives)
        _, _, free = shutil.disk_usage(WORKSPACE_PATH)
        if free < total_size * 2.5:
            print(f"[Error]: Insufficient disk space ({free / 1e9:.2f} GB free, need ~{total_size * 2.5 / 1e9:.2f} GB)")
            sys.exit(1)

    processed_count, detected_platforms, archive_moves = extract_archives_found_with_opts(
        scan_locations, WORKSPACE_PATH, args.platform, args.delete_archives
    )

    # Execution
    try:
        if processed_count > 0 or source_path.suffix == ".zip":
            scan_directory(WORKSPACE_PATH, db_path, platform_filter=args.platform, limit_platforms=detected_platforms)
        else:
            scan_directory(source_path, db_path, platform_filter=args.platform)

        # Post-Ingestion Cleanup
        print("\n--- Cleanup ---")
        cleanup_targets = [p for p in ["facebook", "instagram", "google_chat"] if p in detected_platforms]
        if cleanup_targets:
            clean_json_messages(WORKSPACE_PATH, platforms=cleanup_targets)
        if "google_voice" in detected_platforms:
            clean_google_voice_files(WORKSPACE_PATH)
        if "google_mail" in detected_platforms:
            clean_google_mail_files(WORKSPACE_PATH)

    except Exception as e:
        print(f"\n[Error]: Ingestion failed: {e}")
        for original, processed in archive_moves:
            if processed and processed.exists():
                shutil.move(str(processed), str(original))
        sys.exit(1)


if __name__ == "__main__":
    start_ingestion()
