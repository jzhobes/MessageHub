import json
import sys
import traceback
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

    # Insert label
    cursor.execute("INSERT OR IGNORE INTO thread_labels (thread_id, label) VALUES (?, ?)", (thread_id, "message"))

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
                        INSERT OR IGNORE INTO content 
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


def ingest_facebook_events(cursor, scan_path, my_name):
    """Parses your_event_responses.json into the threads/messages model."""
    p = Path(scan_path) / "Facebook/your_facebook_activity/events/your_event_responses.json"
    if not p.exists():
        return 0, 0

    msg_count = 0
    skipped_count = 0

    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
            events = data.get("event_responses_v2", {}).get("events_joined", [])

            for ev in events:
                title = fix_text(ev.get("name", "Unknown Event"))
                ts_ms = ev.get("start_timestamp", 0) * 1000
                event_id = f"fb_event_{ts_ms}_{hash(title) % 10000}"

                # Create Thread
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO threads (id, platform, title, last_activity_ms, snippet)
                    VALUES (?, 'facebook', ?, ?, ?)
                    """,
                    (event_id, title, ts_ms, "You joined this event."),
                )

                # Insert label
                cursor.execute(
                    "INSERT OR IGNORE INTO thread_labels (thread_id, label) VALUES (?, ?)", (event_id, "event")
                )

                # Create "Message" for RSVP
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO content (thread_id, sender_name, timestamp_ms, content)
                    VALUES (?, ?, ?, ?)
                    """,
                    (event_id, my_name or "Me", ts_ms, "Joined Event"),
                )

                if cursor.rowcount > 0:
                    msg_count += 1
                else:
                    skipped_count += 1

    except Exception as e:
        print(f"Error parsing events: {e}")

    return msg_count, skipped_count


def ingest_facebook_posts(cursor, scan_path, my_name):
    """Parses your_posts__check_ins__photos_and_videos_1.json into threads/messages."""
    p = Path(scan_path) / "Facebook/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json"
    if not p.exists():
        # Heuristic: try finding any posts JSON
        posts_files = list((Path(scan_path) / "Facebook/your_facebook_activity/posts").glob("your_posts_*.json"))
        if not posts_files:
            return 0, 0
        p = posts_files[0]

    msg_count = 0
    skipped_count = 0
    # Merge duplicates and extract data
    merged_data = {}
    try:
        with p.open("r", encoding="utf-8") as f:
            raw_posts = json.load(f)
            for post in raw_posts:
                ts = post.get("timestamp", 0)
                title = post.get("title", "Post")
                key = (ts, title)
                if key not in merged_data:
                    merged_data[key] = post
                else:
                    # Merge data and attachments
                    merged_data[key].setdefault("data", []).extend(post.get("data", []))
                    merged_data[key].setdefault("attachments", []).extend(post.get("attachments", []))

            for (ts, raw_title), post in merged_data.items():
                ts_ms = ts * 1000
                post_title = fix_text(raw_title)

                # Extract content
                content = ""
                for d in post.get("data", []):
                    if "post" in d:
                        content = fix_text(d["post"])
                        break

                # Extract media and shares
                media = []
                share_url = None
                for att in post.get("attachments", []):
                    for d in att.get("data", []):
                        # Link
                        ext_ctx = d.get("external_context", {})
                        place = d.get("place", {})

                        if ext_ctx.get("url"):
                            share_url = ext_ctx["url"]
                        elif place.get("url"):
                            share_url = place["url"]

                        if share_url and share_url.startswith("/"):
                            share_url = f"https://www.facebook.com{share_url}"

                        # Media
                        m_item = d.get("media")
                        if m_item and m_item.get("uri"):
                            uri = m_item["uri"]
                            m_type = "photo" if ".mp4" not in uri.lower() else "video"
                            media.append({"uri": uri, "type": m_type})

                # Deduplicate media by URI
                unique_media = []
                seen_uris = set()
                for m in media:
                    if m["uri"] not in seen_uris:
                        unique_media.append(m)
                        seen_uris.add(m["uri"])

                media_json = json.dumps(unique_media) if unique_media else None
                share_json = json.dumps({"link": share_url}) if share_url else None

                # Determine snippet and final message content
                # If we have content text, use it.
                # Otherwise, if we have a share/media, don't just repeat the title if it's generic.
                msg_content = content
                if not msg_content:
                    if share_url:
                        msg_content = share_url
                    elif unique_media:
                        msg_content = ""  # Let the media bubble speak for itself
                    else:
                        msg_content = post_title

                snippet = content or ("Shared a link" if share_url else "(Media Post)")
                post_id = f"fb_post_{ts_ms}_{hash(post_title) % 10000}"

                # Create Thread
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO threads (id, platform, title, last_activity_ms, snippet)
                    VALUES (?, 'facebook', ?, ?, ?)
                    """,
                    (post_id, post_title, ts_ms, snippet),
                )

                # Insert label
                cursor.execute(
                    "INSERT OR IGNORE INTO thread_labels (thread_id, label) VALUES (?, ?)", (post_id, "post")
                )

                # Create Message
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO content (thread_id, sender_name, timestamp_ms, content, media_json, share_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (post_id, my_name or "Me", ts_ms, msg_content, media_json, share_json),
                )

                if cursor.rowcount > 0:
                    msg_count += 1
                else:
                    skipped_count += 1

    except Exception as e:
        print(f"Error parsing posts: {e}")
        traceback.print_exc()

    return msg_count, skipped_count


def ingest_facebook_checkins(cursor, scan_path, my_name):
    """Parses check-ins.json into threads/messages."""
    p = Path(scan_path) / "Facebook/your_facebook_activity/posts/check-ins.json"
    if not p.exists():
        return 0, 0

    msg_count = 0
    skipped_count = 0

    try:
        with p.open("r", encoding="utf-8") as f:
            checkins = json.load(f)

            for ci in checkins:
                ts_ms = ci.get("timestamp", 0) * 1000

                # Extract location name from label_values
                location_name = "Check-in"
                labels = ci.get("label_values", [])
                message = ""
                for label_item in labels:
                    if label_item.get("label") == "Place tags":
                        d_list = label_item.get("dict", [])
                        for d in d_list:
                            if d.get("label") == "Name":
                                location_name = fix_text(d.get("value", ""))
                    if label_item.get("label") == "Message":
                        message = fix_text(label_item.get("value", ""))

                title = f"Checked in at {location_name}"
                ci_id = f"fb_ci_{ts_ms}_{hash(location_name) % 10000}"

                # Create Thread
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO threads (id, platform, title, last_activity_ms, snippet)
                    VALUES (?, 'facebook', ?, ?, ?)
                    """,
                    (ci_id, title, ts_ms, message or title),
                )

                # Insert label
                cursor.execute(
                    "INSERT OR IGNORE INTO thread_labels (thread_id, label) VALUES (?, ?)", (ci_id, "checkin")
                )

                # Create Message
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO content (thread_id, sender_name, timestamp_ms, content)
                    VALUES (?, ?, ?, ?)
                    """,
                    (ci_id, my_name or "Me", ts_ms, message or title),
                )

                if cursor.rowcount > 0:
                    msg_count += 1
                else:
                    skipped_count += 1

    except Exception as e:
        print(f"Error parsing check-ins: {e}")

    return msg_count, skipped_count


def discover_facebook_identity(scan_path):
    """Scans for Facebook profile information files to discover user identity."""
    p = Path(scan_path) / "Facebook/profile_information/profile_information.json"
    if p.exists():
        try:
            with p.open("r", encoding="utf-8") as f:
                data = json.load(f)
                name = data.get("profile_v2", {}).get("name", {}).get("full_name")
                if name:
                    return name
        except Exception as e:
            print(f"  [Error] Failed to parse Facebook identity file {p}: {e}", file=sys.stderr)
    return None


def discover_instagram_identity(scan_path):
    """Scans for Instagram profile information files to discover user identity."""
    p = Path(scan_path) / "Instagram/personal_information/personal_information/personal_information.json"
    if p.exists():
        try:
            with p.open("r", encoding="utf-8") as f:
                data = json.load(f)
                profile_user = data.get("profile_user", [])
                if profile_user:
                    name = profile_user[0].get("string_map_data", {}).get("Name", {}).get("value")
                    if name:
                        return name
        except Exception as e:
            print(f"  [Error] Failed to parse Instagram identity file {p}: {e}", file=sys.stderr)
    return None
