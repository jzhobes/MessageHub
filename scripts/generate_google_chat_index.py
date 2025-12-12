import os
import json
import glob
import subprocess
import datetime
from utils import fix_text, DATA_DIR

# Resolve paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MESSAGES_ROOT = os.path.join(DATA_DIR, "Google Chat/Groups")
OUTPUT_FILE = os.path.join(DATA_DIR, "google_chat_threads_index.json")

# Dynamically find user info
USERS_ROOT = os.path.join(DATA_DIR, "Google Chat/Users")
USER_NAME = "You"

try:
    if os.path.exists(USERS_ROOT):
        # Look for the first 'User *' folder containing user_info.json
        pattern = os.path.join(USERS_ROOT, "User *", "user_info.json")
        matches = glob.glob(pattern)
        if matches:
            # Pick the first one found
            with open(matches[0], "r", encoding="utf-8") as f:
                gc_data = json.load(f)
                USER_NAME = gc_data.get("user", {}).get("name", "You")
except Exception as e:
    print(f"Warning: Could not auto-detect Google Chat user name: {e}")

print(f"Detected Google Chat user: {USER_NAME}")


def parse_timestamp(date_str):
    try:
        # Format: "Saturday, July 9, 2022 at 2:03:54 PM UTC"
        # Remove UTC and narrow NBSP
        clean_str = date_str.replace(" UTC", "").replace("\u202f", " ")
        dt = datetime.datetime.strptime(clean_str, "%A, %B %d, %Y at %I:%M:%S %p")
        return int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    except Exception:
        return 0


def get_thread_info(thread_dir):
    # All groups should have message_1.json after splitting/processing
    msg_path = os.path.join(thread_dir, "message_1.json")
    info_path = os.path.join(thread_dir, "group_info.json")

    if not os.path.exists(msg_path):
        return None

    try:
        # Read Group Info for Title/Participants
        participants = []
        title = ""
        if os.path.exists(info_path):
            with open(info_path, "r", encoding="utf-8") as f:
                info_data = json.load(f)

                # Prefer explicit group name if it exists
                if "name" in info_data and info_data["name"]:
                    title = info_data["name"]

                # Get participants for fallback title
                members = info_data.get("members", [])
                participants = [m.get("name", "Unknown") for m in members]

        # If no explicit title, derive from participants
        if not title:
            # Exclude the user from title
            others = [p for p in participants if p != USER_NAME]
            if not others:
                title = f"{USER_NAME} (You)"  # Self chat
            else:
                title = ", ".join(others)

        # Read Messages for Snippet/Time
        with open(msg_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        messages = data.get("messages", [])
        if not messages:
            return None  # Empty thread

        # After splitting, message_1.json contains the NEWEST messages in reverse order
        last_msg = messages[0]
        timestamp = parse_timestamp(last_msg.get("created_date", ""))

        sender = last_msg.get("creator", {}).get("name", "Unknown")
        if sender == USER_NAME:
            name = "You"
        else:
            name = sender.split(" ")[0]

        raw_text = last_msg.get("text", "")

        content = ""
        if raw_text:
            content = f"{name}: {raw_text}"
        else:
            # Check attachments
            if last_msg.get("attached_files"):
                content = f"{name} sent an attachment"
            else:
                content = f"{name} sent a message"

        # Count message files (message_1.json, message_2.json, etc.)
        json_files = [f for f in os.listdir(thread_dir) if f.startswith("message_") and f.endswith(".json")]
        file_count = len(json_files) if json_files else 1

        return {
            "id": os.path.basename(thread_dir),
            "title": title,
            "participants": participants,
            "timestamp": timestamp,
            "snippet": content,
            "file_count": file_count,
            "folder_path": thread_dir,
        }
    except Exception as e:
        print(f"Error parsing {thread_dir}: {e}")
        return None


def main():
    if not os.path.exists(MESSAGES_ROOT):
        print(f"Error: {MESSAGES_ROOT} not found.")
        return

    # Run the splitter first
    print("Step 1: Splitting large Google Chat message files...")
    splitter_script = os.path.join(SCRIPT_DIR, "split_google_chat_messages.py")
    try:
        subprocess.run(["python3", splitter_script], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Warning: Splitter failed: {e}")
    except FileNotFoundError:
        print("Warning: Could not run splitter (python3 not found)")

    print("\nStep 2: Indexing Google Chat threads...")

    threads = []
    subdirs = [
        os.path.join(MESSAGES_ROOT, d)
        for d in os.listdir(MESSAGES_ROOT)
        if os.path.isdir(os.path.join(MESSAGES_ROOT, d))
    ]

    print(f"Scanning {len(subdirs)} Google Chat threads...")

    for d in subdirs:
        info = get_thread_info(d)
        if info:
            threads.append(info)

    # Sort by timestamp desc
    threads.sort(key=lambda x: x["timestamp"], reverse=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(threads, f, indent=2)

    print(f"Indexed {len(threads)} threads to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
