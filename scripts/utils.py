import os
import json
import re

# -----------------------------------------------------------------------------
# Configuration & Path Resolution
# -----------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

ENV_FILE = os.path.join(PROJECT_ROOT, ".env")


def get_data_dir():
    """Resolve data directory from root .env or fallback."""
    data_path = None

    # Try to read .env
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r") as f:
                for line in f:
                    if line.strip().startswith("DATA_PATH="):
                        data_path = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                        break
            if data_path:
                print(f"Loaded config from {ENV_FILE}")
        except Exception as e:
            print(f"Warning: Failed to read {ENV_FILE}: {e}")

    if data_path:
        # Handle Windows paths in WSL (e.g. D:\Projects -> /mnt/d/Projects)
        if os.name == "posix" and ":" in data_path and "\\" in data_path:
            drive, rest = data_path.split(":", 1)
            # D:\Projects\MessageHub\data -> /mnt/d/Projects/MessageHub/data
            formatted_rest = rest.replace("\\", "/")
            wsl_path = f"/mnt/{drive.lower()}{formatted_rest}"
            return wsl_path
        return data_path

    return os.path.join(PROJECT_ROOT, "data")


DATA_DIR = get_data_dir()
print(f"Using Data Directory: {DATA_DIR}")


# -----------------------------------------------------------------------------
# Text Utilities
# -----------------------------------------------------------------------------
def fix_text(text):
    """
    Fixes Latin-1 encoding issues common in Meta/Facebook/Instagram exports.
    Also normalizes emoji (like the heart symbol).
    """
    if not text:
        return ""
    try:
        # Re-interpret bytes as UTF-8
        decoded = text.encode("latin1").decode("utf8")
        # Fix heart emoji (U+2764) to be followed by VS-16 (U+FE0F) if not already
        decoded = re.sub(r"\u2764(?!\uFE0F)", "\u2764\ufe0f", decoded)
        return decoded
    except Exception:
        return text


def parse_thread_folder(thread_dir, my_names):
    """
    Generic thread parser for FB/Instagram structure.
    thread_dir: Path to specific thread folder
    my_names: List of strings that represent "Me" (e.g. ["John Doe", "john_doe"])
    """
    msg_path_original = os.path.join(thread_dir, "message_1.json")
    msg_path_processed = os.path.join(thread_dir, "message_1.processed.json")

    msg_path = None
    is_processed = False

    if os.path.exists(msg_path_processed):
        msg_path = msg_path_processed
        is_processed = True
    elif os.path.exists(msg_path_original):
        msg_path = msg_path_original

    if not msg_path:
        return None

    try:
        with open(msg_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        participants = [p.get("name", "Unknown") for p in data.get("participants", [])]
        title = data.get("title")

        # fix encoding if not processed
        if not is_processed:
            if title:
                title = fix_text(title)
            participants = [fix_text(p) for p in participants]

        if not title:
            # Fallback title
            others = [p for p in participants if p not in my_names]
            if others:
                title = ", ".join(others)
            else:
                title = "Unknown Chat"

        # Messages
        messages = data.get("messages", [])
        last_msg = messages[0] if messages else {}
        timestamp = last_msg.get("timestamp_ms", 0)

        sender = last_msg.get("sender_name", "")
        sender_fixed = sender if is_processed else fix_text(sender)

        # Determine strict "You" check
        if sender_fixed in my_names:
            snippet_name = "You"
        else:
            snippet_name = sender_fixed.split(" ")[0]

        raw_content = last_msg.get("content", "")

        snippet = ""
        if raw_content:
            clean_content = raw_content if is_processed else fix_text(raw_content)
            snippet = f"{snippet_name}: {clean_content}"
        else:
            # Determine media type
            if last_msg.get("photos"):
                action = "sent a photo"
            elif last_msg.get("videos"):
                action = "sent a video"
            elif last_msg.get("gifs"):
                action = "sent a gif"
            elif last_msg.get("audio_files"):
                action = "sent an audio message"
            elif last_msg.get("sticker"):
                action = "sent a sticker"
            else:
                action = "sent a message"

            snippet = f"{snippet_name} {action}"

        json_files = [f for f in os.listdir(thread_dir) if f.startswith("message_") and f.endswith(".json")]

        return {
            "id": os.path.basename(thread_dir),
            "title": title,
            "participants": participants,
            "timestamp": timestamp,
            "snippet": snippet,
            "file_count": len(json_files),
            "folder_path": thread_dir,
        }

    except Exception as e:
        print(f"Error parsing {thread_dir}: {e}")
        return None
