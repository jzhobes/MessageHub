import io
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from lib.archives import (  # noqa: E402
    FALLBACK_COMPRESSED_MULTIPLIER,
    ZIP_HEADROOM_MULTIPLIER,
    estimate_required_disk_space,
)


class DiskSpaceEstimateTests(unittest.TestCase):
    def test_zip_uses_exact_uncompressed_size_with_headroom(self):
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = Path(tmp) / "export.zip"
            payload = b"A" * 100_000  # Highly compressible: compressed size is tiny
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("messages.json", payload)

            self.assertLess(zip_path.stat().st_size, 5_000)
            estimated = estimate_required_disk_space([zip_path])
            self.assertEqual(estimated, int(len(payload) * ZIP_HEADROOM_MULTIPLIER))

    def test_targz_falls_back_to_compressed_multiplier(self):
        with tempfile.TemporaryDirectory() as tmp:
            tgz_path = Path(tmp) / "export.tar.gz"
            data = b"hello world" * 1_000
            with tarfile.open(tgz_path, "w:gz") as tf:
                info = tarfile.TarInfo(name="Takeout/Mail/all.mbox")
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))

            expected = int(tgz_path.stat().st_size * FALLBACK_COMPRESSED_MULTIPLIER)
            self.assertEqual(estimate_required_disk_space([tgz_path]), expected)

    def test_corrupt_zip_falls_back_to_compressed_multiplier(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad_zip = Path(tmp) / "corrupt.zip"
            bad_zip.write_bytes(b"not a valid zip archive" * 100)

            expected = int(bad_zip.stat().st_size * FALLBACK_COMPRESSED_MULTIPLIER)
            self.assertEqual(estimate_required_disk_space([bad_zip]), expected)


if __name__ == "__main__":
    unittest.main()
