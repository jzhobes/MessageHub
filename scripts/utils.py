import os
import re
import shutil
import stat
from pathlib import Path, PureWindowsPath

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
        return decoded.strip()
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

    print(f"Cleaning JSON message and profile files in {directory} (Targets: {', '.join(platforms)})...")

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
            if f.endswith(".json") and f != "preview_cache.json":
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
    Deletes processed Google Voice files (HTML and VCF) to save space.
    """
    voice_root = Path(data_dir) / "Voice"
    # Also check nested Takeout
    if not voice_root.exists():
        sub = Path(data_dir) / "Takeout" / "Voice"
        if sub.exists():
            print("  Consolidating Google Voice data from Takeout...")
            merge_folders(sub, voice_root)  # Merge Takeout/Voice into Voice
        else:
            return  # No Google Voice data found

    print("Cleaning up Google Voice source files...")
    deleted_count = 0
    reclaimed_bytes = 0

    # 1. Clean HTML files in specific folders
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

    # 2. Clean Phones.vcf
    vcf = voice_root / "Phones.vcf"
    if vcf.exists():
        try:
            size = vcf.stat().st_size
            vcf.unlink()
            deleted_count += 1
            reclaimed_bytes += size
        except Exception as e:
            print(f"Error deleting {vcf}: {e}")

    mb = reclaimed_bytes / (1024 * 1024)
    print(f"Google Voice Cleanup Complete. Deleted {deleted_count} files ({mb:.2f} MB).")


def clean_google_mail_files(data_dir=WORKSPACE_PATH):
    """
    Deletes processed Google Mail mbox files to save space.
    """
    mail_root = Path(data_dir) / "Mail"
    if not mail_root.exists():
        mail_root = Path(data_dir) / "Takeout" / "Mail"

    if not mail_root.exists():
        return

    print("Cleaning up Google Mail mbox files...")
    deleted_count = 0
    reclaimed_bytes = 0

    for f in mail_root.glob("*.mbox"):
        try:
            size = f.stat().st_size
            f.unlink()
            deleted_count += 1
            reclaimed_bytes += size
        except Exception as e:
            print(f"Error deleting {f}: {e}")

    mb = reclaimed_bytes / (1024 * 1024)
    print(f"Google Mail Cleanup Complete. Deleted {deleted_count} files ({mb:.2f} MB).")


def merge_folders(src, dst):
    """
    Recursively merges src directory into dst directory with progress reporting.
    Deletes src after successful merge.
    """
    src = Path(src)
    dst = Path(dst)

    if not src.exists():
        return

    # Phase 1: Count total files (Discovery)
    total_files = 0
    for root, _, filenames in os.walk(src):
        total_files += len(filenames)

    if total_files == 0:
        # Just clean up the empty folder
        try:
            shutil.rmtree(src)
        except Exception as e:
            print(f"Warning: Could not remove empty source folder {src}: {e}")
        return

    # Phase 2: Targeted Move with Progress
    current_count = 0
    folder_name = src.name

    for root, dirs, filenames in os.walk(src):
        rel_path = Path(root).relative_to(src)
        target_dir = dst / rel_path
        target_dir.mkdir(parents=True, exist_ok=True)

        for f in filenames:
            src_file = Path(root) / f
            dst_file = target_dir / f

            # Move (fast on same drive)
            try:
                if dst_file.exists():
                    try:
                        dst_file.unlink()  # Overwrite if exists
                    except Exception:
                        pass

                shutil.move(str(src_file), str(dst_file))
            except Exception:
                # Fallback to copy if move fails (e.g. cross-device)
                try:
                    shutil.copy2(str(src_file), str(dst_file))
                    src_file.unlink()
                except Exception as e2:
                    print(f"Error merging file {src_file}: {e2}")

            current_count += 1
            if current_count % 100 == 0 or current_count == total_files:
                print(f"[MergeProgress]: {folder_name}|{current_count}|{total_files}")

    # Phase 3: Cleanup empty directories
    def on_rm_error(func, path, exc_info):
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception:
            pass

    try:
        shutil.rmtree(src, onerror=on_rm_error)
    except Exception:
        pass
