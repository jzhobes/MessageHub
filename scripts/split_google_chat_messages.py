import os
import re
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
        with open(messages_file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        messages = data.get("messages", [])
        if not messages:
            print(f"  Warning: No messages found in {group_name}")
            return False

        # Deduplicate attachment export_names (Fix for Google Chat duplicates)
        # Scan disk to find actual available files and map them chronologically

        # 1. Map existing files on disk to their "base" names
        #    File-image.png -> Base: File-image.png, Index: 0
        #    File-image(1).png -> Base: File-image.png, Index: 1
        disk_file_map = {}  # { base_filename: [(index, actual_filename), ...] }

        try:
            for f in os.listdir(group_dir):
                if not os.path.isfile(os.path.join(group_dir, f)):
                    continue

                name_part, ext_part = os.path.splitext(f)

                # Check for (N) pattern at end of name
                # regex: ends with (digits)
                match = re.search(r"^(.*)\((\d+)\)$", name_part)

                if match:
                    base_root = match.group(1)
                    idx = int(match.group(2))
                    base_filename = base_root + ext_part
                else:
                    base_filename = f
                    idx = 0

                if base_filename not in disk_file_map:
                    disk_file_map[base_filename] = []
                disk_file_map[base_filename].append((idx, f))

            # Sort lists by index
            for base in disk_file_map:
                disk_file_map[base].sort(key=lambda x: x[0])

        except Exception as e:
            print(f"  Warning: Failed to scan directory {group_dir}: {e}")

        # 2. Collect all attachment references from JSON
        json_att_map = {}
        for msg in messages:
            if "attached_files" in msg:
                for attachment in msg["attached_files"]:
                    ename = attachment.get("export_name")
                    if ename:
                        if ename not in json_att_map:
                            json_att_map[ename] = []
                        json_att_map[ename].append(attachment)

        # 3. Assign filenames using End-Alignment (Newest-to-Newest)
        #
        # PROBLEM: Google Takeout exports often contain more file attachments on disk than
        # are referenced in messages.json. This usually happens because images from DELETED
        # messages are still included in the export folder (orphaned files), but the message
        # text is removed from the JSON.
        #
        # SYMPTOM: If we align chronologically from the start (Oldest JSON -> Oldest File),
        # the indices drift. For example, if 4 old messages were deleted, the JSON has 4 fewer
        # items than the disk. The 100th message maps to the 100th file, but it SHOULD map
        # to the 104th file because files 1-4 belong to deleted messages. This causes the
        # newest messages to reference the wrong (older) images.
        #
        # SOLUTION: Align from the END (Newest). We assume that the *newest* message corresponds
        # to the *newest* file on disk. Any discrepancy (extra files) is attributed to
        # orphans at the *beginning* of history.
        #
        # EXAMPLE:
        # Disk Files (2470 items): [File(0), File(1) ... File(2469)]
        # JSON Refs (2466 items):  [Msg(0) ... Msg(2465)]
        # Offset = 2470 - 2466 = 4.
        # Mapping: Msg(0) -> File(4) ... Msg(2465) -> File(2469).

        for ename, att_list in json_att_map.items():
            candidates = disk_file_map.get(ename, [])

            # Calculate offset for Right-Alignment
            offset = max(0, len(candidates) - len(att_list))

            if offset > 0:
                print(
                    f"    Info: {ename}: Found {len(candidates)} files on disk but only {len(att_list)} refs in JSON."
                )
                print(f"          Assuming {offset} orphaned files from deleted messages. Aligning to newest files.")

            for i, att in enumerate(att_list):
                # Apply offset to skip assumed orphans
                disk_idx = offset + i

                if disk_idx < len(candidates):
                    # Found exact match on disk
                    att["export_name"] = candidates[disk_idx][1]
                else:
                    # Fallback: JSON has MORE refs than Disk (Missing files)
                    # Use algorithmic naming to generate a logical name based on the index
                    root, ext = os.path.splitext(ename)
                    if disk_idx == 0:
                        att["export_name"] = ename
                    else:
                        att["export_name"] = f"{root}({disk_idx}){ext}"

        # Reverse messages to match Facebook/Instagram order (newest first)
        # Google Chat exports are chronological (oldest first), but UI expects newest first
        messages.reverse()

        # Backup the original
        backup_path = messages_file_path + ".backup"
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

                chunk_data = {"messages": messages[start_idx:end_idx]}

                # Add participants and title from original if present
                if "participants" in data:
                    chunk_data["participants"] = data["participants"]
                if "title" in data:
                    chunk_data["title"] = data["title"]

                # Write chunk file
                chunk_path = os.path.join(group_dir, f"message_{i + 1}.json")
                with open(chunk_path, "w", encoding="utf-8") as f:
                    json.dump(chunk_data, f, indent=2, ensure_ascii=False)

            print(f"  Split into {num_files} files ({MESSAGES_PER_FILE} messages each)")
        else:
            # Small file: just create message_1.json with reversed messages
            chunk_data = {"messages": messages}

            # Add participants and title from original if present
            if "participants" in data:
                chunk_data["participants"] = data["participants"]
            if "title" in data:
                chunk_data["title"] = data["title"]

            chunk_path = os.path.join(group_dir, "message_1.json")
            with open(chunk_path, "w", encoding="utf-8") as f:
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
        messages_file = os.path.join(group_dir, "messages.json")

        if not os.path.exists(messages_file):
            continue

        if split_messages_file(group_dir, messages_file):
            processed_count += 1

    print(f"\nProcessed {processed_count}/{total_groups} groups with messages")


if __name__ == "__main__":
    main()
