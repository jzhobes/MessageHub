import io
import os
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from lib.archives import extract_archives_found_with_opts  # noqa: E402
from utils import merge_folders  # noqa: E402


class CleanupSafetyTests(unittest.TestCase):
    def test_merge_folders_happy_path_removes_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            dst = root / "dst"
            (src / "sub").mkdir(parents=True)
            (src / "a.txt").write_text("alpha")
            (src / "sub" / "b.txt").write_text("beta")
            dst.mkdir()
            (dst / "a.txt").write_text("old-alpha")

            with redirect_stdout(io.StringIO()):
                ok = merge_folders(src, dst)

            self.assertTrue(ok)
            self.assertFalse(src.exists())
            self.assertEqual((dst / "a.txt").read_text(), "alpha")
            self.assertEqual((dst / "sub" / "b.txt").read_text(), "beta")

    def test_merge_folders_preserves_source_when_move_and_copy_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            dst = root / "dst"
            (src / "empty_sub").mkdir(parents=True)
            dst.mkdir()

            failing_file = src / "fail.txt"
            ok_file = src / "ok.txt"
            failing_file.write_text("important-data")
            ok_file.write_text("movable-data")

            orig_replace = os.replace

            def flaky_replace(old, new):
                if Path(old) == failing_file:
                    raise OSError("EXDEV")
                return orig_replace(old, new)

            with (
                patch("utils.os.replace", side_effect=flaky_replace),
                patch("utils.shutil.copy2", side_effect=PermissionError("disk readonly")),
                redirect_stdout(io.StringIO()),
            ):
                ok = merge_folders(src, dst)

            self.assertFalse(ok)
            self.assertTrue(src.exists())
            self.assertTrue(failing_file.exists())
            self.assertEqual(failing_file.read_text(), "important-data")
            self.assertFalse((src / "empty_sub").exists())
            self.assertTrue((dst / "ok.txt").exists())
            self.assertEqual((dst / "ok.txt").read_text(), "movable-data")

    def test_extract_archives_happy_path_deletes_archive_when_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_path = root / "fb.zip"
            with zipfile.ZipFile(archive_path, "w") as zf:
                zf.writestr("your_facebook_activity/messages/inbox/thread1/message_1.json", "{}")

            with redirect_stdout(io.StringIO()):
                processed, detected, moves = extract_archives_found_with_opts(
                    [root], root, platform_filter="all", delete_after=True
                )

            self.assertEqual(processed, 1)
            self.assertEqual(detected, {"facebook"})
            self.assertEqual(moves, [(archive_path, None)])
            self.assertFalse(archive_path.exists())
            self.assertTrue((root / "Facebook/your_facebook_activity/messages/inbox/thread1/message_1.json").exists())

    def test_extract_archives_preserves_archive_on_member_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_path = root / "fb_corrupt.zip"
            with zipfile.ZipFile(archive_path, "w") as zf:
                zf.writestr("your_facebook_activity/messages/inbox/t1/message_1.json", "{}")
                zf.writestr("your_facebook_activity/messages/inbox/t1/bad.json", "{}")

            orig_extract = zipfile.ZipFile.extract

            def failing_extract(self_zf, member, path=None, pwd=None):
                name = member if isinstance(member, str) else member.filename
                if name.endswith("bad.json"):
                    raise zipfile.BadZipFile("CRC error")
                return orig_extract(self_zf, member, path, pwd)

            buf = io.StringIO()
            with patch.object(zipfile.ZipFile, "extract", failing_extract), redirect_stdout(buf):
                processed, detected, moves = extract_archives_found_with_opts(
                    [root], root, platform_filter="all", delete_after=True
                )

            output = buf.getvalue()
            self.assertEqual(processed, 0)
            self.assertEqual(detected, set())
            self.assertEqual(moves, [])
            self.assertTrue(archive_path.exists())
            self.assertFalse((root / ".processed").exists())
            self.assertNotIn("[ArchiveExtracted]:", output)

    def test_extract_archives_rejects_zip_slip_sibling_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target_dir = root / "target"
            target_dir.mkdir()
            sibling_dir = target_dir.parent / "target_evil"
            archive_path = root / "slip.zip"

            with zipfile.ZipFile(archive_path, "w") as zf:
                zf.writestr("your_facebook_activity/messages/inbox/t1/message_1.json", "{}")
                zf.writestr("../../target_evil/pwned.txt", "evil")

            buf = io.StringIO()
            with redirect_stdout(buf):
                processed, _, _ = extract_archives_found_with_opts(
                    [root], target_dir, platform_filter="all", delete_after=False
                )

            self.assertEqual(processed, 1)
            self.assertFalse((sibling_dir / "pwned.txt").exists())
            self.assertIn("Skipping unsafe member", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
