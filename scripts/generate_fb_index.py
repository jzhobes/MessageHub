import os
import json
from utils import parse_thread_folder, fix_text, DATA_DIR

# Load user name from Facebook profile information export
PROFILE_INFO_PATH = os.path.join(DATA_DIR, "Facebook/profile_information/profile_information.json")

USER_NAME = "You"
try:
    with open(PROFILE_INFO_PATH, "r", encoding="utf-8") as f:
        fb_data = json.load(f)
        profile = fb_data.get("profile_user", [{}])[0]
        string_map = profile.get("string_map_data", {})
        raw_name = string_map.get("Name", {}).get("value", "You")

        USER_NAME = fix_text(raw_name)
except Exception as e:
    print(f"Warning: Could not load Facebook profile information: {e}")

# Resolve paths
MESSAGES_ROOT = os.path.join(DATA_DIR, "Facebook/your_facebook_activity/messages")
OUTPUT_FILE = os.path.join(DATA_DIR, "fb_threads_index.json")

FOLDERS_TO_SCAN = ["inbox", "archived_threads", "legacy_threads", "e2ee_cutover"]


def main():
    if not os.path.exists(MESSAGES_ROOT):
        print(f"Error: {MESSAGES_ROOT} not found.")
        return

    all_threads = []

    for folder_name in FOLDERS_TO_SCAN:
        folder_path = os.path.join(MESSAGES_ROOT, folder_name)
        if not os.path.exists(folder_path):
            print(f"Warning: {folder_name} not found, skipping...")
            continue

        subdirs = [
            os.path.join(folder_path, d) for d in os.listdir(folder_path) if os.path.isdir(os.path.join(folder_path, d))
        ]
        print(f"Scanning {len(subdirs)} threads in {folder_name}...")

        for d in subdirs:
            # Pass our set of 'me' names
            info = parse_thread_folder(d, [USER_NAME])
            if info:
                all_threads.append(info)

    all_threads.sort(key=lambda x: x["timestamp"], reverse=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_threads, f, indent=2)

    print(f"Indexed {len(all_threads)} total threads to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
