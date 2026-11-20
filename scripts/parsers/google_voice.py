import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

from utils import fix_text, get_media_type, parse_iso_time


def ingest_google_voice_thread(cursor, thread_data):
    """
    Import one Google Voice thread assembled from HTML files.
    thread_data contains (thread_id, list_of_html_paths).
    """
    thread_id, files = thread_data

    # Calculate thread title
    # The ID is usually a phone number or the name before “ - Text” in the filename.

    # Determine participants
    # A one-to-one thread starts with Me and the other person.
    parts = ["Me", thread_id]
    parts_json = json.dumps(parts)

    msg_count = 0
    skipped_count = 0

    # Track latest metadata for this thread
    last_activity_ms = 0
    latest_snippet = ""

    for fpath in files:
        try:
            with fpath.open("r", encoding="utf-8") as f:
                soup = BeautifulSoup(f, "html.parser")

            # Message Blocks
            # Standard Text export: <div class="message">...</div>
            # Call logs: Might be just the body, or wrapped in hChatLog

            messages = soup.find_all("div", class_="message")

            # Call logs can have one message div or none at all.
            if not messages:
                # If there are no message divs, check whether the body is the call log.
                # Look for an <abbr class="published"> in the body.
                if soup.find("abbr", class_="published"):
                    # Use the whole document as the container in that case.
                    messages = [soup]

            for index, msg_el in enumerate(messages):
                # Skip received, placed, and missed call logs so phone call events stay out of the thread.
                fname = fpath.name
                if " - " in fname:
                    parts = fname.split(" - ")
                    if len(parts) >= 3:
                        category = parts[1].strip().lower()
                        if category in {"received", "placed", "missed", "voicemail", "recorded"}:
                            continue

                # 1. Timestamp
                # <abbr class="dt" title="..."> OR <abbr class="published" title="...">
                ts_el = msg_el.find("abbr", class_=["dt", "published"])
                ts = 0
                if ts_el and ts_el.get("title"):
                    ts = parse_iso_time(ts_el["title"])

                # Use the filename timestamp if the message timestamp is missing or invalid.
                if ts == 0:
                    fname_ts = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z)", fpath.name)
                    if fname_ts:
                        iso_like = fname_ts.group(1).replace("_", ":")
                        ts = parse_iso_time(iso_like)

                # 2. Sender
                # <cite class="sender vcard"><a class="tel"><abbr class="fn">Me</abbr></a></cite>
                # Or <cite ...><span class="fn">Name</span></cite>
                # Or "Voicemail from ..." logic

                sender = "Unknown"

                if "Voicemail" in fpath.name:
                    # Look for “Voicemail from” or the contributor markup.
                    # <div class="contributor vcard"> ... <a class="tel" href="tel:...">
                    contrib = soup.find("div", class_="contributor")
                    if contrib:
                        tel_a = contrib.find("a", class_="tel")
                        if tel_a:
                            sender_href = tel_a.get("href", "")
                            if "tel:" in sender_href:
                                sender = sender_href.replace("tel:", "")

                    if sender == "Unknown":
                        sender = thread_id  # Fallback

                else:
                    # Text / Call
                    sender_el = msg_el.find(class_="sender")
                    if sender_el:
                        # Check for class="fn" on either an abbr or a span.
                        fn_el = sender_el.find(class_="fn")
                        if fn_el:
                            sender = fn_el.get_text().strip()
                        else:
                            # Use the tel link if the name is missing.
                            tel_el = sender_el.find("a", class_="tel")
                            if tel_el:
                                href = tel_el.get("href", "")
                                sender = href.replace("tel:", "")
                    else:
                        # Implicit sender based on file type
                        if "Placed" in fpath.name:
                            sender = "Me"
                        elif "Received" in fpath.name or "Missed" in fpath.name:
                            sender = thread_id

                # Normalize "Me"
                if sender.lower() == "me":
                    sender = "Me"
                elif not sender or sender == "Unknown":
                    # If we're out of better clues, “Received” means it came from the other person.
                    if "Received" in fpath.name or "Missed" in fpath.name:
                        sender = thread_id

                sender = fix_text(sender)

                # 3. Content
                content_text = ""
                q_el = msg_el.find("q")
                if q_el:
                    # Beautiful Soup's separator turns <br> tags into line breaks for us.
                    content_text = q_el.get_text("\n").strip()

                # Fallback content for call logs
                if not content_text:
                    if "Missed" in fpath.name:
                        content_text = "Missed Call"
                    elif "Placed" in fpath.name:
                        content_text = "Placed Call"
                    elif "Received" in fpath.name:
                        content_text = "Received Call"
                    # Voicemail can be audio only.

                # 4. Media
                media = []

                # Images
                for img in msg_el.find_all("img"):
                    src = img.get("src")
                    if src:
                        # Google Voice exports often leave the extension off media URLs.
                        # Check the files on disk for the full name.
                        if "." not in src:
                            for ext in [".jpg", ".jpeg", ".png", ".gif"]:
                                if (fpath.parent / (src + ext)).exists():
                                    src += ext
                                    break
                        rel_path = f"Voice/Calls/{src}"
                        m_type = get_media_type(src, default="photo")
                        media.append({"uri": rel_path, "type": m_type})

                # Audio
                for audio in msg_el.find_all("audio"):
                    src = audio.get("src")
                    if src:
                        if "." not in src:
                            for ext in [".mp3", ".wav", ".m4a"]:
                                if (fpath.parent / (src + ext)).exists():
                                    src += ext
                                    break
                        rel_path = f"Voice/Calls/{src}"
                        m_type = get_media_type(src, default="audio")
                        media.append({"uri": rel_path, "type": m_type})

                # VCF (Contacts)
                for link in msg_el.find_all("a"):
                    href = link.get("href")
                    if href and href.lower().endswith(".vcf"):
                        rel_path = f"Voice/Calls/{href}"
                        m_type = get_media_type(href)
                        media.append({"uri": rel_path, "type": m_type})

                media_json = json.dumps(media) if media else None

                # 5. Insert
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO content 
                    (thread_id, sender_name, timestamp_ms, content, media_json, reactions_json, share_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (thread_id, sender, ts, content_text, media_json, None, None),
                )

                if cursor.rowcount > 0:
                    msg_count += 1
                else:
                    skipped_count += 1

                # Metadata update
                if ts >= last_activity_ms:
                    last_activity_ms = ts
                    if "Voicemail" in fpath.name:
                        latest_snippet = "Voicemail"
                    elif content_text:
                        latest_snippet = f"{sender}: {content_text}"
                    elif media:
                        latest_snippet = f"{sender} sent a file"

        except Exception as e:
            print(f"Error processing GV file {fpath}: {e}")

    # Update Thread Metadata
    if msg_count > 0:
        # Only create the thread if we imported at least one message. Otherwise we'd leave an empty stub.
        cursor.execute(
            """
            INSERT OR REPLACE INTO threads (id, platform, title, participants_json, last_activity_ms, snippet)
            VALUES (?, 'google_voice', ?, ?, ?, ?)
            """,
            (thread_id, thread_id, parts_json, last_activity_ms, latest_snippet),
        )

        # Insert label
        cursor.execute("INSERT OR IGNORE INTO thread_labels (thread_id, label) VALUES (?, 'message')", (thread_id,))

    return msg_count, skipped_count


def ingest_google_voice(cursor, voice_root):
    """
    Import Google Voice messages, grouping files into threads by the phone number in the filename.
    """

    calls_dir = Path(voice_root) / "Calls"
    if not calls_dir.exists():
        return 0, 0

    print("Scanning Google Voice data...")

    # Group files by the phone number we'll use as the thread ID.
    # Filename format: "{PHONE} - {TYPE} - {TIMESTAMP}.html"
    file_groups = {}  # { "+1555...": [Path, Path] }

    re_fname = re.compile(r"^(.*?)\s+-\s+(Text|Voicemail|Placed|Received|Missed)")
    re_fname_anon = re.compile(r"^\s+-\s+(Text|Voicemail|Placed|Received|Missed)")

    count = 0
    for f in calls_dir.glob("*.html"):
        name = f.name
        thread_id = "Unknown"

        match = re_fname.match(name)
        if match:
            thread_id = match.group(1).strip()
        else:
            match_anon = re_fname_anon.match(name)
            if match_anon:
                thread_id = "Unknown"
            else:
                # If the standard pattern doesn't match, use the prefix before the first separator (e.g., “Group Conversation”).
                if " - " in name:
                    thread_id = name.split(" - ", 1)[0].strip()
                else:
                    continue

        if thread_id not in file_groups:
            file_groups[thread_id] = []
        file_groups[thread_id].append(f)
        count += 1

    print(f"Found {count} Google Voice metadata files across {len(file_groups)} threads.")
    print("Starting processing...")

    # 2. Ingest groups
    processed_threads = 0
    total_msgs = 0
    total_skipped = 0

    for tid, files in file_groups.items():
        m, s = ingest_google_voice_thread(cursor, (tid, files))
        total_msgs += m
        total_skipped += s
        processed_threads += 1

        if processed_threads % 50 == 0:
            print(f"  ... Processed {processed_threads} GV threads...")

    print(f"Google Voice Ingestion Complete: {total_msgs} messages, {total_skipped} skipped.")
    return total_msgs, total_skipped


def discover_google_voice_identity(scan_path):
    """
    Look for the Google Voice number in Phones.vcf. Return None if it isn't there.
    """
    p = Path(scan_path) / "Voice/Phones.vcf"
    if p.exists():
        try:
            with p.open("r", encoding="utf-8") as f:
                content = f.read()
                # Look for a number followed by the Google Voice label
                # Typical structure:
                # item1.TEL:+15555555555
                # item1.X-ABLabel:Google Voice
                match = re.search(r"item(\d+)\.TEL:(.*?)\nitem\1\.X-ABLabel:Google Voice", content, re.MULTILINE)
                if match:
                    return match.group(2).strip()
        except Exception:
            pass

    return None
