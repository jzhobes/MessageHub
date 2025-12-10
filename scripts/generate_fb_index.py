
import os
import json
import datetime

# Resolve paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_ROOT = os.path.join(PROJECT_ROOT, "data/FB/your_facebook_activity/messages/inbox")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "data/FB/fb_threads_index.json")

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
        if sender == 'John Ho' or sender == 'Virtual Me':
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
    if not os.path.exists(DATA_ROOT):
        print(f"Error: {DATA_ROOT} not found. Run this from virtual-me/data/FB directory.")
        return

    threads = []
    subdirs = [os.path.join(DATA_ROOT, d) for d in os.listdir(DATA_ROOT) if os.path.isdir(os.path.join(DATA_ROOT, d))]
    
    print(f"Scanning {len(subdirs)} threads...")
    
    for d in subdirs:
        info = get_thread_info(d)
        if info:
            threads.append(info)
            
    # Sort by timestamp desc
    threads.sort(key=lambda x: x['timestamp'], reverse=True)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(threads, f, indent=2)
        
    print(f"Indexed {len(threads)} threads to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
