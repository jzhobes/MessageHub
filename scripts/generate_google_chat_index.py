
import os
import json
import datetime
from dateutil import parser  # We might need this, or custom parsing if dateutil isn't available

# Resolve paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_ROOT = os.path.join(PROJECT_ROOT, "data/Google Chat/Groups")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "data/google_chat_threads_index.json")

def parse_timestamp(date_str):
    try:
        # Format: "Saturday, July 9, 2022 at 2:03:54 PM UTC"
        # Since we might not have dateutil installed in this environment, let's try standard strptime
        # But 'PM UTC' ... strptime %Z might fail or ignore UTC if not set up.
        # Let's try to remove UTC and parse
        clean_str = date_str.replace(" UTC", "").replace("\u202f", " ") # Remove narrow non-breaking space
        dt = datetime.datetime.strptime(clean_str, "%A, %B %d, %Y at %I:%M:%S %p")
        # Assume UTC
        return int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    except Exception as e:
        # Fallback or print error
        # print(f"Date parse error: {date_str} - {e}")
        return 0

def get_thread_info(thread_dir):
    # Check for messages.json
    msg_path = os.path.join(thread_dir, "messages.json")
    info_path = os.path.join(thread_dir, "group_info.json")
    
    if not os.path.exists(msg_path):
        return None
    
    try:
        # Read Group Info for Title/Participants
        participants = []
        title = ""
        if os.path.exists(info_path):
            with open(info_path, 'r', encoding='utf-8') as f:
                info_data = json.load(f)
                members = info_data.get('members', [])
                participants = [m.get('name', 'Unknown') for m in members]
                
        # If no explicit title (Google Chat groups usually don't have one unless named), derive from participants
        # Exclude "John Ho" (User) from title usually, but let's keep all for now or filter
        # Assuming "John Ho" is the user
        others = [p for p in participants if p != "John Ho" and p != "Virtual Me"]
        if not others:
            title = "John Ho (You)" # Self chat?
        else:
            title = ", ".join(others)

        # Read Messages for Snippet/Time
        with open(msg_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        messages = data.get('messages', [])
        if not messages:
            return None # Empty thread
            
        # Get LAST message (Google Chat export messages seem chronological, so last is at end?)
        # Let's check the sample... valid, sample started 2018, ended 2023. So index 0 is OLDEST.
        # We want the NEWEST for the snippet/sorting. So messages[-1].
        last_msg = messages[-1]
        
        timestamp = parse_timestamp(last_msg.get('created_date', ''))
        
        sender = last_msg.get('creator', {}).get('name', 'Unknown')
        if sender == 'John Ho' or sender == 'Virtual Me':
            name = "You"
        else:
            name = sender.split(' ')[0]

        raw_text = last_msg.get('text', '')
        
        content = ""
        if raw_text:
             content = f"{name}: {raw_text}"
        else:
            # Check attachments
            if last_msg.get('attached_files'):
                content = f"{name} sent an attachment"
            else:
                content = f"{name} sent a message"
        
        return {
            "id": os.path.basename(thread_dir),
            "title": title,
            "participants": participants,
            "timestamp": timestamp,
            "snippet": content,
            "file_count": 1, # Google Chat usually puts everything in one file per group
            "folder_path": thread_dir
        }
    except Exception as e:
        print(f"Error parsing {thread_dir}: {e}")
        return None

def main():
    if not os.path.exists(DATA_ROOT):
        print(f"Error: {DATA_ROOT} not found.")
        return

    threads = []
    subdirs = [os.path.join(DATA_ROOT, d) for d in os.listdir(DATA_ROOT) if os.path.isdir(os.path.join(DATA_ROOT, d))]
    
    print(f"Scanning {len(subdirs)} Google Chat threads...")
    
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
