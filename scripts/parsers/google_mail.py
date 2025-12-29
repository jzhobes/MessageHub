from email.header import decode_header
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
import json
import mailbox
from pathlib import Path
import re

from bs4 import BeautifulSoup

from utils import fix_text, get_media_type


def get_body(msg):
    """Extracts the best available text body from a message."""
    if msg.is_multipart():
        # Prefer text/plain, fallback to text/html
        plain = None
        html = None
        for part in msg.walk():
            ctype = part.get_content_type()
            cdisp = str(part.get("Content-Disposition"))

            if "attachment" in cdisp:
                continue

            if ctype == "text/plain":
                try:
                    plain = part.get_payload(decode=True).decode("utf-8", errors="replace")
                except Exception:
                    pass
            elif ctype == "text/html":
                try:
                    html = part.get_payload(decode=True).decode("utf-8", errors="replace")
                except Exception:
                    pass

        return plain if plain else (html if html else "")
    else:
        try:
            return msg.get_payload(decode=True).decode("utf-8", errors="replace")
        except Exception:
            return ""


def decode_mime_header(val):
    """Decodes RFC 2047 encoded headers (e.g. =?UTF-8?Q?...?=)."""
    if not val:
        return ""
    try:
        parts = decode_header(str(val))
        decoded_parts = []
        for content, encoding in parts:
            if isinstance(content, bytes):
                decoded_parts.append(content.decode(encoding or "utf-8", errors="replace"))
            else:
                decoded_parts.append(str(content))
        return "".join(decoded_parts)
    except Exception:
        return str(val)


def get_plain_text_snippet(html_or_text, length=100):
    """Returns a clean plain-text snippet from HTML or text."""
    if not html_or_text:
        return ""

    # Try to strip HTML if it looks like HTML
    if "<" in html_or_text and ">" in html_or_text:
        try:
            soup = BeautifulSoup(html_or_text, "html.parser")
            text = soup.get_text(separator=" ").strip()
            # Replace multiple spaces/newlines with a single space
            text = re.sub(r"\s+", " ", text)
            return text[:length]
        except Exception:
            pass

    # Fallback to simple slicing if not HTML or BS4 fails
    text = re.sub(r"\s+", " ", html_or_text).strip()
    return text[:length]


def clean_html(html):
    """Removes HTML tags and returns formatted text."""
    if not html:
        return ""

    # If it's not looking like HTML, just do a basic clean
    if not ("<html" in html.lower() or "<body" in html.lower() or "</div>" in html.lower() or "<p" in html.lower()):
        return unwrap_text(html.strip())

    try:
        soup = BeautifulSoup(html, "html.parser")
        # Keep newlines for the stripper to work correctly
        return soup.get_text(separator="\n").strip()
    except Exception:
        return html.strip()


def unwrap_text(text):
    """
    Joins lines that were likely hard-wrapped by email clients.
    Preserves double-newlines as paragraph breaks.
    """
    if not text:
        return ""

    # Standardize newlines
    text = text.replace("\r\n", "\n")

    # Split into potential paragraphs
    paragraphs = text.split("\n\n")
    cleaned_paragraphs = []

    for para in paragraphs:
        # For each paragraph, join lines that start with lowercase (soft wraps)
        lines = para.split("\n")
        if not lines:
            continue

        unwrapped = lines[0]
        for next_line in lines[1:]:
            stripped_next = next_line.strip()
            if not stripped_next:
                continue

            # If the next line starts with lowercase, it's likely a wrapped line
            if stripped_next and stripped_next[0].islower():
                unwrapped = unwrapped.rstrip() + " " + stripped_next
            else:
                unwrapped = unwrapped.rstrip() + "\n" + stripped_next

        cleaned_paragraphs.append(unwrapped.strip())

    return "\n\n".join(cleaned_paragraphs).strip()


def strip_quoted_text(text):
    """
    Attempts to remove historical email quotes and reply headers.
    Returns only the "new" content of the message.
    """
    if not text:
        return ""

    lines = text.split("\n")
    cleaned_lines = []

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # 1. Traditional ">" quoting
        if stripped.startswith(">"):
            break

        # 2. Outlook/Forwarding style "From:" header
        if re.match(r"^(From|Sent|To|Subject):\s+.*", stripped, re.IGNORECASE):
            # If we see multiple headers in a row, it's definitely a quoted block
            break

        # 3. "-----Original Message-----"
        if re.match(r"^-+Original Message-+$", stripped, re.IGNORECASE):
            break

        # 4. Multi-line "On [Date], [Name] wrote:"
        # Gmail often wraps this across multiple lines.
        # Check if this line starts with "On " and look ahead for "wrote:"
        if stripped.startswith("On "):
            found_wrote = False
            # Look ahead up to 4 lines
            for j in range(i, min(i + 5, len(lines))):
                if lines[j].strip().lower().endswith("wrote:"):
                    found_wrote = True
                    break
            if found_wrote:
                break

        cleaned_lines.append(line)
        i += 1

    return "\n".join(cleaned_lines).strip()


def parse_participants(msg):
    """Extracts all participants (From, To, Cc) as names."""
    parts = []
    for header in ["from", "to", "cc"]:
        val = msg.get(header)
        if val:
            # val can be a comma-separated list of addresses
            # Use getaddresses to properly parse them
            addr_list = getaddresses([str(val)])
            for name, addr in addr_list:
                clean_name = fix_text(name if name else addr)
                if clean_name:
                    parts.append(clean_name)
    return sorted(list(set(parts)))


def extract_external_images(html):
    """Parses HTML for interesting external images, excluding quoted history."""
    if not html:
        return []

    results = []
    try:
        soup = BeautifulSoup(html, "html.parser")

        # Remove quoted history to avoid picking up old GIFs
        for quote in soup.find_all("div", class_="gmail_quote"):
            quote.decompose()

        for img in soup.find_all("img"):
            src = img.get("src")
            if not src:
                continue

            # Interesting patterns: Tenor, Giphy, or Google proxies
            src_lower = src.lower()
            if any(p in src_lower for p in ["tenor.com", "giphy.com", "googleusercontent.com/proxy"]):
                results.append({"uri": src, "type": "photo"})
    except Exception:
        pass
    return results


def strip_html_quotes(html):
    """Surgically removes quoted history from HTML body."""
    if not html:
        return ""
    try:
        soup = BeautifulSoup(html, "html.parser")
        # Gmail specific
        for quote in soup.find_all("div", class_="gmail_quote"):
            quote.decompose()
        # Other common patterns
        for blockquote in soup.find_all("blockquote"):
            blockquote.decompose()
        return str(soup)
    except Exception:
        return html


def map_cid_to_local(html, media):
    """Replaces cid: references in HTML with local /api/media URLs."""
    if not html or not media:
        return html

    # media is a list of {"uri": "Mail/attachments/...", "type": "photo"}
    # We need to find if any of these were CIDs
    for m in media:
        uri = m["uri"]
        fname = uri.split("/")[-1]

        # If the filename was derived from a CID (e.g. ii_k1r2z3x4.png)
        # We try to match it back
        cid_match = re.match(r"^(.*?)\.[a-z0-9]+$", fname)
        if cid_match:
            cid = cid_match.group(1)
            # Replace cid:cid with /api/media?path=...
            # Note: We use the webapp path format
            local_url = f"/api/media?path={uri}&platform=google_mail"
            html = html.replace(f"cid:{cid}", local_url)

    return html


def ingest_google_mail_mbox(cursor, mbox_path, identity_stats):
    """
    Ingests a Google Takeout MBOX file into the database.
    Updates identity_stats (email -> { 'names': set(), 'count': int }) in-place.
    Returns: (msg_total, skipped_total)
    """
    mbox_file = Path(mbox_path)
    if not mbox_file.exists():
        return 0, 0

    print(f"Parsing MBOX: {mbox_file.name}...")
    mbox = mailbox.mbox(mbox_path)

    msg_total = 0
    skipped_total = 0

    cache_threads = {}

    for i, message in enumerate(mbox):
        try:
            # Label detection for thread_labels
            raw_labels = str(message.get("X-Gmail-Labels", ""))
            current_message_labels = set()
            if "Sent" in raw_labels:
                current_message_labels.add("sent")
            if "Inbox" in raw_labels:
                current_message_labels.add("inbox")

            # 1. Collect identity from 'Delivered-To' header only
            # This is the most accurate and reliable way to identify the mailbox owner
            # Delivered-To is added by Gmail servers and always contains the actual recipient email
            delivered_to = str(message.get("Delivered-To", ""))
            if delivered_to:
                addr_list = getaddresses([delivered_to])
                for name, addr in addr_list:
                    if not addr:
                        continue
                    addr = addr.lower().strip()
                    if addr not in identity_stats:
                        identity_stats[addr] = {"names": set(), "count": 0}
                    identity_stats[addr]["count"] += 1

            # 2. Thread ID
            gm_thrid = message.get("X-GM-THRID")
            if not gm_thrid:
                subject = message.get("subject", "No Subject")
                gm_thrid = re.sub(r"[^a-zA-Z0-9]", "_", subject)[:50]
            thread_id = f"gm_{gm_thrid}"

            from_header = str(message.get("from", "Unknown"))
            name, addr = parseaddr(decode_mime_header(from_header))
            sender = fix_text(name if name else addr)
            subject = fix_text(decode_mime_header(str(message.get("subject", "(No Subject)"))))
            date_str = message.get("date")

            try:
                dt = parsedate_to_datetime(date_str) if date_str else None
                ts = int(dt.timestamp() * 1000) if dt else 0
            except Exception:
                ts = 0

            # 3. Content Extraction (HTML Preferred for EmailItem)
            # Find both parts if they exist
            plain_body = ""
            html_body = ""

            if message.is_multipart():
                for part in message.walk():
                    ctype = part.get_content_type()
                    cdisp = str(part.get("Content-Disposition"))
                    if "attachment" in cdisp:
                        continue

                    if ctype == "text/plain":
                        try:
                            plain_body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                        except Exception:
                            pass
                    elif ctype == "text/html":
                        try:
                            html_body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                        except Exception:
                            pass
            else:
                ctype = message.get_content_type()
                if ctype == "text/html":
                    html_body = message.get_payload(decode=True).decode("utf-8", errors="replace")
                else:
                    plain_body = message.get_payload(decode=True).decode("utf-8", errors="replace")

            # 4. Media Extraction (Do this before content processing to map CIDs)
            media = []
            attach_dir = mbox_file.parent / "attachments"
            attach_dir.mkdir(exist_ok=True)

            if message.is_multipart():
                for part in message.walk():
                    ctype = part.get_content_type()
                    cdisp = str(part.get("Content-Disposition"))

                    is_image = ctype.startswith("image/")
                    is_attach = "attachment" in cdisp

                    if is_image or is_attach:
                        payload = part.get_payload(decode=True)
                        if not payload:
                            continue

                        fname = part.get_filename()
                        if not fname:
                            cid = part.get("Content-ID")
                            ext = ctype.split("/")[-1] if "/" in ctype else "bin"
                            if cid:
                                fname = cid.strip("<>") + "." + ext
                            else:
                                fname = f"inline_{ts}_{msg_total}.{ext}"

                        fname = re.sub(r"[^a-zA-Z0-9._-]", "_", fname)
                        save_path = attach_dir / fname
                        try:
                            if not save_path.exists():
                                with open(save_path, "wb") as f:
                                    f.write(payload)

                            rel_path = f"Mail/attachments/{fname}"
                            m_type = "photo" if is_image else get_media_type(fname)
                            media.append({"uri": rel_path, "type": m_type})
                        except Exception as e:
                            print(f"  [Error] Failed to save attachment {fname}: {e}")

            # 5. Content Processing (HTML focus)
            content = ""
            if html_body:
                # Strip history from HTML
                cleaned_html = strip_html_quotes(html_body)
                # Map inline image CIDs
                content = map_cid_to_local(cleaned_html, media)
            elif plain_body:
                # Fallback to plain text, strip quotes, and convert to basic HTML
                stripped_plain = strip_quoted_text(plain_body)
                unwrapped = unwrap_text(stripped_plain)
                content = f"<div style='white-space: pre-wrap;'>{unwrapped}</div>"

            # 6. Merge with external images (GIFs)
            external_imgs = extract_external_images(html_body if html_body else plain_body)
            for ext_img in external_imgs:
                if not any(m["uri"] == ext_img["uri"] for m in media):
                    media.append(ext_img)

            media_json = json.dumps(media) if media else None

            # 7. Insert Content
            cursor.execute(
                """
                INSERT OR IGNORE INTO content 
                (thread_id, sender_name, timestamp_ms, content, media_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (thread_id, sender, ts, content, media_json),
            )

            if cursor.rowcount > 0:
                msg_total += 1

                # Update Thread cache
                if thread_id not in cache_threads:
                    cache_threads[thread_id] = {
                        "title": subject,
                        "participants": parse_participants(message),
                        "last_ms": ts,
                        "snippet": get_plain_text_snippet(content),
                        "labels": current_message_labels,
                    }
                else:
                    if ts > cache_threads[thread_id]["last_ms"]:
                        cache_threads[thread_id]["last_ms"] = ts
                        cache_threads[thread_id]["snippet"] = get_plain_text_snippet(content)

                    # Accumulate labels across all messages in thread
                    cache_threads[thread_id]["labels"].update(current_message_labels)
            else:
                skipped_total += 1

            if i % 100 == 0:
                print(f"  ... Processed {i} emails...")

        except Exception as e:
            print(f"Error processing message {i} in MBOX: {e}")

    # Commit Threads and Labels
    print(f"Finishing {len(cache_threads)} threads...")
    for tid, info in cache_threads.items():
        participants_json = json.dumps(info["participants"])
        cursor.execute(
            """
            INSERT OR REPLACE INTO threads (id, platform, title, participants_json, is_group, last_activity_ms, snippet)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(tid),
                "google_mail",
                str(info["title"]),
                participants_json,
                1 if len(info["participants"]) > 2 else 0,
                int(info["last_ms"]),
                str(info["snippet"]),
            ),
        )

        # Insert all labels encountered for this thread
        labels = info.get("labels", set())

        # Ensure every Gmail thread has at least one label (default to inbox)
        if not labels:
            labels = {"inbox"}

        for label in labels:
            cursor.execute(
                "INSERT OR IGNORE INTO thread_labels (thread_id, label) VALUES (?, ?)", (str(tid), label.lower())
            )

    return msg_total, skipped_total


def discover_google_mail_identity(gmail_identity_stats):
    """
    Determines the most likely owner of the Gmail account based on 'To' field counts.
    Returns: (best_email, names, count) or None
    """
    if not gmail_identity_stats:
        return None

    # Sort by message count descending
    sorted_emails = sorted(gmail_identity_stats.items(), key=lambda x: x[1]["count"], reverse=True)
    if not sorted_emails:
        return None

    best_email, data = sorted_emails[0]
    return best_email, list(data["names"]), data["count"]
