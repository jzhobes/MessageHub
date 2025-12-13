import os

import re
from datetime import datetime
from pathlib import Path

# -----------------------------------------------------------------------------
# Configuration & Path Resolution
# -----------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent


ENV_FILE = PROJECT_ROOT / ".env"


def get_data_dir():
    """Resolve data directory from root .env or fallback."""
    data_path = None

    # Try to read .env
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r") as f:
                for line in f:
                    if line.strip().startswith("DATA_PATH="):
                        val = line.strip().split("=", 1)[1].strip()
                        # Allow optional quotes
                        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                            val = val[1:-1]
                        data_path = val
                        break
            if data_path:
                print(f"Loaded config from {ENV_FILE}")
        except Exception as e:
            print(f"Warning: Failed to read {ENV_FILE}: {e}")

    if data_path:
        from pathlib import PureWindowsPath

        # Handle Windows paths (e.g. D:\Projects) when running in POSIX (WSL/Mac)
        if os.name == "posix" and (":" in data_path or "\\" in data_path):
            try:
                # Treat the string specifically as a Windows path
                win_path = PureWindowsPath(data_path)

                # If absolute Windows path with drive (e.g. D:/Project)
                if win_path.drive:
                    drive_letter = win_path.drive.rstrip(":").lower()
                    # Convert remainder to posix style slashes (e.g. \Projects -> /Projects)
                    # as_posix() on the relative part preserves hierarchy
                    rel_path = win_path.relative_to(win_path.anchor).as_posix()
                    return f"/mnt/{drive_letter}/{rel_path}"
                else:
                    # Just normal slash conversion if no drive letter
                    return win_path.as_posix()
            except Exception:
                # Fallback if parsing fails
                pass

        return Path(data_path)

    return PROJECT_ROOT / "data"


DATA_DIR = get_data_dir()
print(f"Using Data Directory: {DATA_DIR}")


# -----------------------------------------------------------------------------
# Text Utilities
# -----------------------------------------------------------------------------
def fix_text(text):
    """
    Fixes Latin-1 encoding issues common in Meta/Facebook/Instagram exports.
    Also normalizes emoji (like the heart symbol).
    """
    if not text:
        return ""
    try:
        # Re-interpret bytes as UTF-8
        decoded = text.encode("latin1").decode("utf8")
        # Fix heart emoji (U+2764) to be followed by VS-16 (U+FE0F) if not already
        decoded = re.sub(r"\u2764(?!\uFE0F)", "\u2764\ufe0f", decoded)
        return decoded
    except Exception:
        return text


def parse_iso_time(iso_str):
    """
    Parses Google Chat ISO timestamp to milliseconds.
    Example: "Monday, May 20, 2013 at 2:11:12 PM UTC"
    """
    if not iso_str:
        return 0

    # Try dateutil first if available (robust)
    try:
        from dateutil import parser

        dt = parser.parse(iso_str)
        return int(dt.timestamp() * 1000)
    except ImportError:
        pass
    except Exception:
        pass

    # Fallback to naive parsing for the specific known format
    # "Monday, May 20, 2013 at 2:11:12 PM UTC"
    # Remove " at ", " UTC", " " (narrow nbsp)
    clean = iso_str.replace(" at ", " ").replace(" UTC", "").replace("\u202f", " ")

    try:
        # Format: "%A, %B %d, %Y %I:%M:%S %p"
        dt = datetime.strptime(clean, "%A, %B %d, %Y %I:%M:%S %p")
        return int(dt.timestamp() * 1000)
    except ValueError:
        return 0


def clean_json_messages(directory, platforms=None):
    """
    Recursively deletes message JSON files from the specified directory
    to save space / cleanup after ingestion.

    platforms: List of strings (e.g. ["facebook", "instagram"]).
               If None or empty, defaults to ["all"].
    """
    directory = Path(directory)
    if not directory.exists():
        return

    if not platforms:
        platforms = ["all"]

    # Normalize inputs
    platforms = [p.lower() for p in platforms]
    check_all = "all" in platforms

    deleted_count = 0
    reclaimed_bytes = 0

    print(f"Cleaning JSON message files in {directory} (Targets: {', '.join(platforms)})...")

    # Walk directory
    for root, dirs, files in os.walk(directory):
        root_path = Path(root)

        # Filter by platform folder heuristic if specific platforms requested
        if not check_all:
            # Check if current path belongs to a requested platform
            path_str = str(root_path).lower()

            is_target = False
            for p in platforms:
                # Map shorthand to folder names or partial path match
                keyword = p
                if p == "google":
                    keyword = "google chat"

                if keyword in path_str:
                    is_target = True
                    break

            if not is_target:
                continue

        for f in files:
            # Match standard Facebook/Instagram/Google patterns
            if f == "messages.json" or (f.startswith("message_") and f.endswith(".json")):
                file_path = root_path / f
                try:
                    size = file_path.stat().st_size
                    file_path.unlink()
                    deleted_count += 1
                    reclaimed_bytes += size
                except Exception as e:
                    print(f"Error deleting {file_path}: {e}")

    mb = reclaimed_bytes / (1024 * 1024)
    print(f"Cleanup Complete. Deleted {deleted_count} files ({mb:.2f} MB).")
