import json
import re
from pathlib import Path
from utils import fix_text, parse_iso_time


def normalize_participants(participant_list):
    """Normalizes participant names for consistent ID generation."""
    clean = [fix_text(p).strip() for p in participant_list if p]
    return sorted(list(set(clean)))


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

        for base in disk_file_map:
            disk_file_map[base].sort(key=lambda x: x[0])

    except Exception as e:
        print(f"Warning scanning dir {thread_dir}: {e}")

    # 2. Collect all attachment references
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

    # 4. Resolve Filenames
    for ename, att_list in json_att_map.items():
        candidates = disk_file_map.get(ename, [])
        if not candidates and "?" in ename:
            sanitized = ename.replace("?", "_")
            candidates = disk_file_map.get(sanitized, [])

        offset = max(0, len(candidates) - len(att_list))

        for i, att in enumerate(att_list):
            disk_idx = offset + i
            if disk_idx < len(candidates):
                att["export_name"] = candidates[disk_idx][1]
            else:
                # Fallback
                p_ename = Path(ename)
                root = p_ename.stem
                ext = p_ename.suffix
                if disk_idx > 0:
                    att["export_name"] = f"{root}({disk_idx}){ext}"
                elif "?" in ename:
                    att["export_name"] = ename.replace("?", "_")

    # Process messages
    msg_count = 0
    for m in all_messages:
        try:
            sender = m.get("creator", {}).get("name", "Unknown")
            created_date = m.get("created_date", "")
            ts = parse_iso_time(created_date)
            content = fix_text(m.get("text", ""))

            annotations = m.get("annotations", [])
            annotations_json = json.dumps(annotations) if annotations else None

            media = []
            if "attached_files" in m:
                for att in m["attached_files"]:
                    export_name = att.get("export_name")
                    if export_name:
                        uri = f"{thread_id}/{export_name}"
                        media.append({"uri": uri, "type": "file"})

            media_json = json.dumps(media) if media else None

            reactions = []
            if "reactions" in m:
                for r in m["reactions"]:
                    emoji = r.get("emoji", {}).get("unicode", "")
                    for email in r.get("reactor_emails", []):
                        reactions.append({"reaction": emoji, "actor": email})
            reactions_json = json.dumps(reactions) if reactions else None

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
                msg_count += 1
            else:
                skipped_count += 1

            if ts >= last_activity_ms:
                last_activity_ms = ts
                if content:
                    latest_snippet = f"{sender}: {content}"
                elif media:
                    latest_snippet = f"{sender} sent a {media[0]['type']}"
                else:
                    latest_snippet = f"{sender} sent a message"

        except Exception as e:
            print(f"Error processing message in {thread_dir}: {e}")

    if last_activity_ms > 0:
        cursor.execute(
            "UPDATE threads SET last_activity_ms = ?, snippet = ? WHERE id = ?",
            (last_activity_ms, latest_snippet, thread_id),
        )

    return msg_count, skipped_count
