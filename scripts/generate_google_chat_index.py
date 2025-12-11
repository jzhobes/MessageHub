
import os
import json
import glob
import subprocess
import datetime
from dateutil import parser  # We might need this, or custom parsing if dateutil isn't available

# Resolve paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_ROOT = os.path.join(PROJECT_ROOT, "data/Google Chat/Groups")
USERS_ROOT = os.path.join(PROJECT_ROOT, "data/Google Chat/Users")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "data/google_chat_threads_index.json")

# Auto-detect user name from Google Chat export
def get_user_name():
    try:
        # Search recursively for the user_info.json file
        pattern = os.path.join(USERS_ROOT, "**", "user_info.json")
        matches = glob.glob(pattern, recursive=True)
        if matches:
            with open(matches[0], "r", encoding="utf-8") as f:
                user_data = json.load(f)
                return user_data.get("user", {}).get("name", "You")
    except Exception as e:
        print(f"Warning: Could not auto-detect user name: {e}")
    return "You"

USER_NAME = get_user_name()
print(f"Detected user: {USER_NAME}")

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
    # All groups should have message_1.json after processing
    msg_path = os.path.join(thread_dir, "message_1.json")
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
                
                # Prefer explicit group name if it exists
                if 'name' in info_data and info_data['name']:
                    title = info_data['name']
                
                # Get participants for fallback title
                members = info_data.get('members', [])
                participants = [m.get('name', 'Unknown') for m in members]
                
        # If no explicit title, derive from participants
        if not title:
            # Exclude the user from title
            others = [p for p in participants if p != USER_NAME]
            if not others:
                title = f"{USER_NAME} (You)"  # Self chat
            else:
                title = ", ".join(others)


        # Read Messages for Snippet/Time
        with open(msg_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        messages = data.get('messages', [])
        if not messages:
            return None # Empty thread
            
        # After splitting, message_1.json contains the NEWEST messages in reverse order
        # So messages[0] is the most recent message
        last_msg = messages[0]

        
        timestamp = parse_timestamp(last_msg.get('created_date', ''))
        
        sender = last_msg.get('creator', {}).get('name', 'Unknown')
        if sender == USER_NAME:
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
        
        # Count message files (message_1.json, message_2.json, etc.)
        json_files = [f for f in os.listdir(thread_dir) if f.startswith('message_') and f.endswith('.json')]
        file_count = len(json_files) if json_files else 1
        
        return {
            "id": os.path.basename(thread_dir),
            "title": title,
            "participants": participants,
            "timestamp": timestamp,
            "snippet": content,
            "file_count": file_count,
            "folder_path": thread_dir
        }
    except Exception as e:
        print(f"Error parsing {thread_dir}: {e}")
        return None

def main():
    if not os.path.exists(DATA_ROOT):
        print(f"Error: {DATA_ROOT} not found.")
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
