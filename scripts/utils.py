import os
import re
import stat
from pathlib import Path

# External dependencies (assumes venv is active)
try:
    from dateutil import parser
except ImportError:
    print("Error: 'python-dateutil' is required. Please install it via 'pip install -r scripts/requirements.txt'")
    exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("Error: 'python-dotenv' is required. Please install it via 'pip install -r scripts/requirements.txt'")
    exit(1)

# -----------------------------------------------------------------------------
# Configuration & Path Resolution
# -----------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
ENV_FILE = PROJECT_ROOT / ".env"

# Load environment variables
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
    print(f"Loaded config from {ENV_FILE}")


def get_workspace_path():
    """Resolve data directory from root .env or fallback."""
    workspace_path = os.environ.get("WORKSPACE_PATH")

    if workspace_path:
        from pathlib import PureWindowsPath

        # Handle Windows paths (e.g. D:\Projects) when running in POSIX (WSL/Mac)
        if os.name == "posix" and (":" in workspace_path or "\\" in workspace_path):
            try:
                # Treat the string specifically as a Windows path
                win_path = PureWindowsPath(workspace_path)

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

        return Path(workspace_path)

    return PROJECT_ROOT / "data"


WORKSPACE_PATH = get_workspace_path()
print(f"Using Workspace: {WORKSPACE_PATH}")


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
    Parses timestamps (Google Chat ISO, Google Voice ISO, etc) to milliseconds using dateutil.
    """
    if not iso_str:
        return 0

    try:
        # dateutil handles "Monday, May 20..." and "2023-01-01T..." automatically
        dt = parser.parse(iso_str)
        return int(dt.timestamp() * 1000)
    except Exception:
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


def clean_google_voice_files(data_dir=WORKSPACE_PATH):
    """
    Deletes processed Google Voice HTML files to save space.
    Target: Voice/Calls/*.html
    """
    voice_root = Path(data_dir) / "Voice"
    # Also check nested Takeout
    if not voice_root.exists():
        sub = Path(data_dir) / "Takeout" / "Voice"
        if sub.exists():
            voice_root = sub

    if not voice_root.exists():
        return

    print("Cleaning up Google Voice HTML files...")
    deleted_count = 0
    reclaimed_bytes = 0

    # Folders to clean
    targets = ["Calls", "Spam", "Trash", "Archive"]

    for t in targets:
        target_dir = voice_root / t
        if not target_dir.exists():
            continue

        for f in target_dir.glob("*.html"):
            try:
                size = f.stat().st_size
                f.unlink()
                deleted_count += 1
                reclaimed_bytes += size
            except Exception as e:
                print(f"Error deleting {f}: {e}")

    mb = reclaimed_bytes / (1024 * 1024)
    print(f"Google Voice Cleanup Complete. Deleted {deleted_count} files ({mb:.2f} MB).")


def merge_folders(src, dst):
    """
    Recursively merges src directory into dst directory.
    Uses shutil.copytree with dirs_exist_ok=True (Python 3.8+).
    Deletes src after successful merge.
    """
    import shutil

    src = Path(src)
    dst = Path(dst)

    if not src.exists():
        return

    print(f"Merging {src.name} into {dst.name}...")
    try:
        dst.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dst, dirs_exist_ok=True)

        # Robust deletion for Windows (handles read-only files)
        def on_rm_error(func, path, exc_info):
            os.chmod(path, stat.S_IWRITE)
            func(path)

        shutil.rmtree(src, onerror=on_rm_error)
    except Exception as e:
        print(f"Error merging {src} to {dst}: {e}")
