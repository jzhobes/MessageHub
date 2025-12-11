
import os
import json
import shutil

# Resolve paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
GOOGLE_CHAT_ROOT = os.path.join(PROJECT_ROOT, "data/Google Chat/Groups")

# Split files larger than 5MB
MAX_FILE_SIZE_MB = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Target ~200 messages per file (adjust based on average message size)
MESSAGES_PER_FILE = 200

def split_messages_file(group_dir, messages_file_path):
    """
    Process messages.json file:
    - For large files (>5MB): Split into message_1.json, message_2.json, etc.
    - For small files: Create message_1.json with reversed messages
    - Always keeps the original as messages.json.backup
    """
    group_name = os.path.basename(group_dir)
    
    try:
        # Read the original file
        with open(messages_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        messages = data.get('messages', [])
        if not messages:
            print(f"  Warning: No messages found in {group_name}")
            return False
        
        # Reverse messages to match Facebook/Instagram order (newest first)
        # Google Chat exports are chronological (oldest first), but UI expects newest first
        messages.reverse()
        
        # Backup the original
        backup_path = messages_file_path + '.backup'
        if not os.path.exists(backup_path):
            shutil.copy2(messages_file_path, backup_path)
        
        # Check file size to determine if splitting is needed
        file_size = os.path.getsize(messages_file_path)
        needs_split = file_size >= MAX_FILE_SIZE_BYTES
        
        if needs_split:
            print(f"  Splitting {group_name} ({file_size / 1024 / 1024:.1f} MB)...")
            
            # Split messages into chunks
            total_messages = len(messages)
            num_files = (total_messages + MESSAGES_PER_FILE - 1) // MESSAGES_PER_FILE
            
            for i in range(num_files):
                start_idx = i * MESSAGES_PER_FILE
                end_idx = min((i + 1) * MESSAGES_PER_FILE, total_messages)
                
                chunk_data = {
                    'messages': messages[start_idx:end_idx]
                }
                
                # Add participants and title from original if present
                if 'participants' in data:
                    chunk_data['participants'] = data['participants']
                if 'title' in data:
                    chunk_data['title'] = data['title']
                
                # Write chunk file
                chunk_path = os.path.join(group_dir, f'message_{i + 1}.json')
                with open(chunk_path, 'w', encoding='utf-8') as f:
                    json.dump(chunk_data, f, indent=2, ensure_ascii=False)
            
            print(f"  Split into {num_files} files ({MESSAGES_PER_FILE} messages each)")
        else:
            # Small file: just create message_1.json with reversed messages
            chunk_data = {
                'messages': messages
            }
            
            # Add participants and title from original if present
            if 'participants' in data:
                chunk_data['participants'] = data['participants']
            if 'title' in data:
                chunk_data['title'] = data['title']
            
            chunk_path = os.path.join(group_dir, 'message_1.json')
            with open(chunk_path, 'w', encoding='utf-8') as f:
                json.dump(chunk_data, f, indent=2, ensure_ascii=False)
            
            print(f"  Processed {group_name} (small file, created message_1.json)")
        
        return True
        
    except Exception as e:
        print(f"  Error processing {group_name}: {e}")
        return False

def main():
    if not os.path.exists(GOOGLE_CHAT_ROOT):
        print(f"Error: {GOOGLE_CHAT_ROOT} not found.")
        return
    
    print(f"Processing Google Chat message files (splitting files > {MAX_FILE_SIZE_MB}MB)...")
    
    processed_count = 0
    total_groups = 0
    
    for group_name in os.listdir(GOOGLE_CHAT_ROOT):
        group_dir = os.path.join(GOOGLE_CHAT_ROOT, group_name)
        
        if not os.path.isdir(group_dir):
            continue
        
        total_groups += 1
        messages_file = os.path.join(group_dir, 'messages.json')
        
        if not os.path.exists(messages_file):
            continue
        
        if split_messages_file(group_dir, messages_file):
            processed_count += 1
    
    print(f"\nProcessed {processed_count}/{total_groups} groups with messages")

if __name__ == "__main__":
    main()
