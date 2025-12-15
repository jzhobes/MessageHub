import json

from pathlib import Path
from utils import fix_text


def normalize_participants(participant_list):
    """Normalizes participant names for consistent ID generation."""
    clean = [fix_text(p).strip() for p in participant_list if p]
    return sorted(list(set(clean)))


def ingest_facebook_entry(cursor, thread_dir, thread_id_override=None):
    """Refers to Facebook/Instagram unified ingestion."""
    return ingest_facebook_instagram_thread(cursor, thread_dir, "facebook", thread_id_override)


def ingest_instagram_entry(cursor, thread_dir, thread_id_override=None):
    return ingest_facebook_instagram_thread(cursor, thread_dir, "instagram", thread_id_override)


def ingest_facebook_instagram_thread(cursor, thread_dir, platform, thread_id_override=None):
    """
    Ingests a single Facebook or Instagram thread folder.
    This logic is shared because the JSON export structure is nearly identical for both.
    """
    thread_path = Path(thread_dir)
    thread_id = thread_id_override if thread_id_override else thread_path.name

    # Collect all message json files
    # pattern: message_1.json, message_2.json ...
    message_files = sorted(thread_path.glob("message_*.json"))
    if not message_files:
        return 0, 0

    # Parse Metadata (Title, Participants) from the first file (usually newest)
    title = ""
    participants = []

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
                            latest_snippet = f"{sender} sent a {media[0]['type']}"
                        else:
                            latest_snippet = f"{sender} sent a message"

        except Exception as e:
            print(f"Error reading {mf}: {e}")

    # Update thread with metadata
    if last_activity_ms > 0:
        cursor.execute(
            "UPDATE threads SET last_activity_ms = ?, snippet = ? WHERE id = ?",
            (last_activity_ms, latest_snippet, thread_id),
        )

    return msg_count, skipped_count
