
import os
import json
import datetime

# Load user name from Facebook profile information export
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE_INFO_PATH = os.path.join(PROJECT_ROOT, "data/Facebook/profile_information/profile_information.json")
try:
    with open(PROFILE_INFO_PATH, "r", encoding="utf-8") as f:
        fb_data = json.load(f)
        # Assuming top-level contains 'profile_user' similar to Instagram
        profile = fb_data.get('profile_user', [{}])[0]
        string_map = profile.get('string_map_data', {})
        USER_NAME = string_map.get('Name', {}).get('value', 'You')
except Exception as e:
    print(f"Warning: Could not load Facebook profile information: {e}")
    USER_NAME = "You"

# Resolve paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
MESSAGES_ROOT = os.path.join(PROJECT_ROOT, "data/Facebook/your_facebook_activity/messages")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "data/fb_threads_index.json")

# Folders to scan for threads
FOLDERS_TO_SCAN = ["inbox", "archived_threads", "legacy_threads", "e2ee_cutover"]

def get_thread_info(thread_dir):
    # Try reading message_1.json
    p = os.path.join(thread_dir, "message_1.json")
    if not os.path.exists(p):
        return None
    
    try:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        participants = [p['name'] for p in data.get('participants', []) if 'name' in p]
        title = data.get('title')
        if not title:
            title = ", ".join(participants)
            
        # Get last message for snippet/time
        messages = data.get('messages', [])
        last_msg = messages[0] if messages else {}
        timestamp = last_msg.get('timestamp_ms', 0)
        
        # Determine sender name for snippet
        sender = last_msg.get('sender_name', '')
        if sender == USER_NAME:
            name = "You"
        else:
            name = sender.split(' ')[0]

        raw_content = last_msg.get('content', '')
        
        if raw_content:
             # Text message: "Name: Content"
             content = f"{name}: {raw_content}"
        else:
             # Media message: "Name sent a ..."
            if last_msg.get('photos'):
                action = "sent a photo"
            elif last_msg.get('videos'):
                action = "sent a video"
            elif last_msg.get('gifs'):
                action = "sent a gif"
            elif last_msg.get('audio_files'):
                action = "sent an audio message"
            elif last_msg.get('sticker'):
                action = "sent a sticker"
            else:
                action = "sent a message"
            
            content = f"{name} {action}"
        
        # Count JSON files to guess pagination
        # message_1.json, message_2.json ...
        json_files = [f for f in os.listdir(thread_dir) if f.startswith('message_') and f.endswith('.json')]
        
        return {
            "id": os.path.basename(thread_dir),
            "title": title,
            "participants": participants,
            "timestamp": timestamp,
            "snippet": content,
            "file_count": len(json_files),
            "folder_path": thread_dir
        }
    except Exception as e:
        print(f"Error parsing {thread_dir}: {e}")
        return None

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
            
        subdirs = [os.path.join(folder_path, d) for d in os.listdir(folder_path) if os.path.isdir(os.path.join(folder_path, d))]
        
        print(f"Scanning {len(subdirs)} threads in {folder_name}...")
        
        for d in subdirs:
            info = get_thread_info(d)
            if info:
                all_threads.append(info)
            
    # Sort by timestamp desc
    all_threads.sort(key=lambda x: x['timestamp'], reverse=True)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(all_threads, f, indent=2)
        
    print(f"Indexed {len(all_threads)} total threads to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
