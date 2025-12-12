import os
import json
from utils import parse_thread_folder, fix_text, DATA_DIR

# Load user name from Instagram profile information
PROFILE_INFO_PATH = os.path.join(DATA_DIR, "Instagram/personal_information/personal_information.json")

USER_NAME = "You"
try:
    with open(PROFILE_INFO_PATH, "r", encoding="utf-8") as f:
        ig_data = json.load(f)
        profile = ig_data.get("profile_user", [{}])[0]
        string_map = profile.get("string_map_data", {})
        raw_name = string_map.get("Name", {}).get("value", "You")
        USER_NAME = fix_text(raw_name)

except Exception as e:
    print(f"Warning: Could not load Instagram profile information: {e}")

# Resolve paths
MESSAGES_ROOT = os.path.join(DATA_DIR, "Instagram/your_instagram_activity/messages/inbox")
OUTPUT_FILE = os.path.join(DATA_DIR, "ig_threads_index.json")


def main():
    if not os.path.exists(MESSAGES_ROOT):
        print(f"Error: {MESSAGES_ROOT} not found.")
        return

    threads = []
    # Identify subdirectories (threads)
    try:
        subdirs = [
            os.path.join(MESSAGES_ROOT, d)
            for d in os.listdir(MESSAGES_ROOT)
            if os.path.isdir(os.path.join(MESSAGES_ROOT, d))
        ]
    except Exception as e:
        print(f"Error listing directories: {e}")
        return

    print(f"Scanning {len(subdirs)} threads...")

    my_names = [USER_NAME, "You"]

    for d in subdirs:
        # Pass list of my names (real name + username)
        info = parse_thread_folder(d, my_names)
        if info:
            threads.append(info)

    threads.sort(key=lambda x: x["timestamp"], reverse=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(threads, f, indent=2)

    print(f"Indexed {len(threads)} threads to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
