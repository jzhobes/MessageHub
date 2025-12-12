import os
import json
from utils import fix_text, DATA_DIR

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
print(f"Using Data Directory: {DATA_DIR}")


def recursive_fix(obj):
    """Recursively apply fix_text to all strings in a dictionary or list."""
    if isinstance(obj, str):
        return fix_text(obj)
    elif isinstance(obj, list):
        return [recursive_fix(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: recursive_fix(value) for key, value in obj.items()}
    else:
        return obj


def process_directory(base_path):
    print(f"Scanning {base_path}...")

    count = 0
    skipped = 0

    for root, dirs, files in os.walk(base_path):
        for file in files:
            if file.startswith("message_") and file.endswith(".json") and not file.endswith(".processed.json"):
                input_path = os.path.join(root, file)
                output_path = input_path.replace(".json", ".processed.json")

                # Check if processed file already exists and is newer
                if os.path.exists(output_path):
                    in_mtime = os.path.getmtime(input_path)
                    out_mtime = os.path.getmtime(output_path)
                    if out_mtime > in_mtime:
                        skipped += 1
                        continue

                try:
                    with open(input_path, "r", encoding="utf-8") as f:
                        data = json.load(f)

                    fixed_data = recursive_fix(data)

                    with open(output_path, "w", encoding="utf-8") as f:
                        json.dump(fixed_data, f, ensure_ascii=False, indent=2)

                    count += 1
                    if count % 100 == 0:
                        print(f"Processed {count} files...")

                except Exception as e:
                    print(f"Error processing {input_path}: {e}")

    print(f"Done. Processed: {count}, Skipped (Assuming up-to-date): {skipped}")


def main():
    fb_path = os.path.join(DATA_DIR, "Facebook/your_facebook_activity/messages")
    ig_path = os.path.join(DATA_DIR, "Instagram/your_instagram_activity/messages/inbox")

    if os.path.exists(fb_path):
        process_directory(fb_path)
    else:
        print(f"Facebook path not found: {fb_path}")

    if os.path.exists(ig_path):
        process_directory(ig_path)
    else:
        print(f"Instagram path not found: {ig_path}")


if __name__ == "__main__":
    main()
