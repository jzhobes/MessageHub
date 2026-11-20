import os
import json
import shutil
import tarfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from utils import merge_folders

ZIP_HEADROOM_MULTIPLIER = 1.2
FALLBACK_COMPRESSED_MULTIPLIER = 2.5


def estimate_required_disk_space(archives):
    """
    Estimates peak workspace disk space (in bytes) required to extract and index `archives`.
    Uses exact uncompressed central-directory sizes (+20% DB/index headroom) for `.zip` files,
    falling back to `2.5x` compressed size for `.tar.gz`/`.tgz` or unreadable zips.
    """
    required_bytes = 0.0
    for archive in archives:
        archive_path = Path(archive)
        if archive_path.suffix.lower() == ".zip":
            try:
                with zipfile.ZipFile(archive_path, "r") as zf:
                    uncompressed = sum(info.file_size for info in zf.infolist())
                required_bytes += uncompressed * ZIP_HEADROOM_MULTIPLIER
                continue
            except (zipfile.BadZipFile, OSError):
                pass
        required_bytes += archive_path.stat().st_size * FALLBACK_COMPRESSED_MULTIPLIER
    return int(required_bytes)


def extract_archives_found(search_dirs, target_root, platform_filter="all"):
    """
    Scans specified directories for .zip/.tar.gz files and extracts them
    into a subdirectory of target_root named after the zip file.
    Returns: tuple (processed_count, set_of_platforms_detected, archive_moves)
    archive_moves: list of (original_Path, processed_Path)
    """
    return extract_archives_found_with_opts(search_dirs, target_root, platform_filter, False)


def extract_archives_found_with_opts(
    search_dirs, target_root, platform_filter="all", delete_after=False, explicit_archives=None
):
    """
    Scans specified directories (and any explicit archive paths) for .zip/.tar.gz/.tgz files
    and extracts them into target_root (or platform subdirectories).
    Explicit archives are left untouched in place when delete_after=False, and deleted after
    successful extraction when delete_after=True.
    Returns: tuple (processed_count, set_of_platforms_detected, archive_moves)
    archive_moves: list of (original_Path, processed_Path_or_None)
    """
    processed = 0
    target_root = Path(target_root)
    archive_moves = []
    extraction_lock = threading.Lock()

    seen_zips = set()
    explicit_resolved = set()
    detected_platforms = set()

    # Collect all archives first
    all_archives = []
    if explicit_archives:
        for a in explicit_archives:
            a_path = Path(a)
            if not a_path.exists():
                print(f"  Warning: Explicit archive not found, skipping: {a_path}")
                continue
            resolved = a_path.resolve()
            explicit_resolved.add(resolved)
            if resolved not in seen_zips:
                seen_zips.add(resolved)
                all_archives.append(a_path)

    for d in search_dirs:
        d_path = Path(d)
        if not d_path.exists():
            continue
        archives = list(d_path.glob("*.zip")) + list(d_path.glob("*.tgz")) + list(d_path.glob("*.tar.gz"))
        for a in archives:
            if a.resolve() not in seen_zips:
                seen_zips.add(a.resolve())
                all_archives.append(a)

    if not all_archives:
        return 0, set(), []

    def process_archive(archive_path):
        """
        Worker function to extract a single archive.
        Returns (success_bool, detected_platform_set, move_info)
        """
        local_detected = set()
        is_zip = archive_path.suffix == ".zip"
        is_tar = archive_path.name.endswith(".tar.gz") or archive_path.name.endswith(".tgz")

        archive_obj = None
        try:
            file_list = []

            # Open Archive
            if is_zip:
                archive_obj = zipfile.ZipFile(archive_path, "r")
                file_list = archive_obj.namelist()
            elif is_tar:
                archive_obj = tarfile.open(archive_path, "r:gz")
                file_list = archive_obj.getnames()
            else:
                return False, None, None

            # signatures
            has_voice = any(f.startswith("Takeout/Voice/") for f in file_list)
            has_chat = any(f.startswith("Takeout/Google Chat/") for f in file_list)
            has_mail = any(f.startswith("Takeout/Mail/") for f in file_list)
            is_insta = any(f.startswith("your_instagram_activity") for f in file_list) or any(
                "instagram_profile_information.json" in f for f in file_list
            )
            is_fb = any(f.startswith("your_facebook_activity") for f in file_list) or any(
                "personal_information/profile_information/" in f for f in file_list
            )

            is_e2e = False
            if is_zip and not is_fb and not is_insta:
                from parsers.facebook_e2e import is_e2e_document
                for name in file_list:
                    if name.endswith('.json') and '/' not in name:
                        try:
                            is_e2e = is_e2e_document(json.loads(archive_obj.read(name)))
                        except (ValueError, UnicodeError):
                            continue
                        if is_e2e:
                            is_fb = True
                            break

            # Filter Check
            if platform_filter != "all":
                allowed = False
                if platform_filter == "google_voice" and has_voice:
                    allowed = True
                if platform_filter == "google_chat" and has_chat:
                    allowed = True
                if platform_filter == "google_mail" and has_mail:
                    allowed = True
                if platform_filter == "instagram" and is_insta:
                    allowed = True
                if platform_filter == "facebook" and is_fb:
                    allowed = True

                if not allowed:
                    print(f"  Skipping {archive_path.name}: Filter mismatch.")
                    return False, None, None

            # Extract
            dest_dir = target_root
            if is_insta:
                dest_dir = target_root / "Instagram"
            if is_fb:
                dest_dir = target_root / "Facebook"

            if is_e2e:
                dest_dir = target_root / "Facebook/your_facebook_activity/e2e"

            # Identification Logging
            if has_voice or has_chat or has_mail:
                print(f"  [Thread] Extracting Google Takeout: {archive_path.name}")
                if has_voice:
                    local_detected.add("google_voice")
                if has_chat:
                    local_detected.add("google_chat")
                if has_mail:
                    local_detected.add("google_mail")
            elif is_insta:
                print(f"  [Thread] Extracting Instagram: {archive_path.name}")
                local_detected.add("instagram")
            elif is_fb:
                print(f"  [Thread] Extracting Facebook: {archive_path.name}")
                local_detected.add("facebook")
            else:
                print(f"  Skipping {archive_path.name}: Unknown structure.")
                return False, None, None

            # Prepare destination directory (Locked)
            with extraction_lock:
                if not dest_dir.exists():
                    dest_dir.mkdir(parents=True, exist_ok=True)
                elif dest_dir.is_file():
                    print(f"  [Error] Cannot extract to {dest_dir}: file already exists with this name.")
                    return False, None, None

            # Perform Extraction (Unlocked for Parallelism)
            members = archive_obj.namelist() if is_zip else archive_obj.getmembers()
            total_members = len(members)
            print(f"[ArchiveStarted]: {archive_path.name}|{total_members}")

            dest_dir_real = os.path.realpath(dest_dir)
            failed_members = 0

            for i, member in enumerate(members):
                member_name = member if is_zip else member.name
                try:
                    # Security Check: Prevent Zip Slip (path traversal)
                    target_path = os.path.realpath(os.path.join(dest_dir_real, member_name))
                    try:
                        is_safe = os.path.commonpath([dest_dir_real, target_path]) == dest_dir_real
                    except ValueError:
                        is_safe = False
                    if not is_safe:
                        print(f"  [Security] Skipping unsafe member (potential Zip Slip): {member_name}")
                        continue

                    archive_obj.extract(member, dest_dir)
                    if (i + 1) % 50 == 0 or (i + 1) == total_members:
                        print(f"[ArchiveProgress]: {archive_path.name}|{i + 1}|{total_members}")
                except Exception as e:
                    failed_members += 1
                    print(f"  Warning: Failed to extract {member_name} from {archive_path.name}: {e}")

            if failed_members > 0:
                print(
                    f"  [Error] Incomplete extraction for {archive_path.name}: "
                    f"{failed_members} member(s) failed. Preserving archive."
                )
                return False, None, None

            print(f"[ArchiveExtracted]: {archive_path.name}")

        except Exception as e:
            print(f"  Error processing {archive_path.name}: {e}")
            return False, None, None
        finally:
            if archive_obj is not None:
                try:
                    archive_obj.close()
                except Exception:
                    pass

        # Post-Processing: Delete, Preserve (explicit), or Move to .processed
        try:
            with extraction_lock:
                if delete_after:
                    archive_path.unlink()
                    print(f"  [Post] Deleted archive: {archive_path.name}")
                    return True, local_detected, (archive_path, None)
                elif archive_path.resolve() in explicit_resolved:
                    print(f"  [Post] Preserved original archive: {archive_path.name}")
                    return True, local_detected, (archive_path, None)
                else:
                    processed_dir = target_root / ".processed"
                    os.makedirs(processed_dir, exist_ok=True)

                    destination = processed_dir / archive_path.name
                    if destination.exists():
                        timestamp = int(time.time() * 1000)
                        destination = processed_dir / f"{archive_path.stem}_{timestamp}{archive_path.suffix}"

                    # Double check archive still exists
                    if not archive_path.exists():
                        return True, local_detected, None

                    shutil.move(str(archive_path), str(destination))
                    return True, local_detected, (archive_path, destination)
        except Exception as e:
            print(f"  Warning: Move/Delete failed for {archive_path.name}: {e}")
            return True, local_detected, None

    # Run Parallel
    max_workers = min(4, len(all_archives))
    print(f"Starting extraction of {len(all_archives)} archives...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(process_archive, a) for a in all_archives]
        for future in as_completed(futures):
            success, platforms, move_info = future.result()
            if success:
                processed += 1
                if platforms:
                    detected_platforms.update(platforms)
                if move_info:
                    archive_moves.append(move_info)

    # Post-Extraction Structural Cleanup (Sequential)
    # Google Voice
    if "google_voice" in detected_platforms:
        src = target_root / "Takeout" / "Voice"
        dst = target_root / "Voice"
        if src.exists():
            print("  Consolidating Google Voice data...")
            if not merge_folders(src, dst):
                print(f"  Warning: Incomplete consolidation for {src}; failed source files were preserved.")

    # Google Chat
    if "google_chat" in detected_platforms:
        src = target_root / "Takeout" / "Google Chat"
        dst = target_root / "Google Chat"
        if src.exists():
            print("  Consolidating Google Chat data...")
            if not merge_folders(src, dst):
                print(f"  Warning: Incomplete consolidation for {src}; failed source files were preserved.")

    # Google Mail
    if "google_mail" in detected_platforms:
        src = target_root / "Takeout" / "Mail"
        dst = target_root / "Mail"
        if src.exists():
            print("  Consolidating Google Mail data...")
            if not merge_folders(src, dst):
                print(f"  Warning: Incomplete consolidation for {src}; failed source files were preserved.")

    # Final cleanup: remove empty Takeout folder
    takeout_root = target_root / "Takeout"
    if takeout_root.exists() and not any(takeout_root.iterdir()):
        try:
            takeout_root.rmdir()
            print("Removed empty Takeout folder.")
        except Exception:
            pass

    return processed, detected_platforms, archive_moves
