import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.db_ops import SCHEMA_SQL
from parsers.facebook_e2e import ingest_e2e, reconcile_cutovers
from parsers.facebook import ingest_facebook_entry


class E2ETests(unittest.TestCase):
    def test_cutover_separate_and_repeat(self):
        for folder, merge in [('e2ee_cutover', True), ('archived_threads', False)]:
            with self.subTest(folder=folder), tempfile.TemporaryDirectory() as tmp:
                conn = sqlite3.connect(':memory:')
                conn.executescript(SCHEMA_SQL)
                c = conn.cursor()
                p = Path(tmp) / folder / 'person_123'
                p.mkdir(parents=True)
                (p / 'message_1.json').write_text(json.dumps({'title': 'Person', 'participants': [{'name': 'Me'}, {'name': 'Person'}], 'messages': [{'sender_name': 'Me', 'timestamp_ms': 100, 'content': 'old'}]}))
                e = Path(tmp) / 'Person_9.json'
                e.write_text(json.dumps({'threadName': 'Person_9', 'participants': ['Me', 'Person'], 'messages': [{'senderName': 'Person', 'timestamp': 200, 'text': '', 'media': [{'uri': './media/a.jpeg'}], 'reactions': []}]}))
                ingest_e2e(c, e)
                ingest_facebook_entry(c, p)
                reconcile_cutovers(c)
                ingest_e2e(c, e)
                ingest_facebook_entry(c, p)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM content').fetchone()[0], 2)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM threads').fetchone()[0], 1 if merge else 2)
                self.assertEqual(c.execute('SELECT MAX(last_activity_ms) FROM threads').fetchone()[0], 200)
                if merge:
                    self.assertEqual(c.execute('SELECT COUNT(*) FROM content WHERE thread_id="person_123"').fetchone()[0], 2)
                else:
                    self.assertTrue(c.execute("SELECT 1 FROM thread_labels WHERE label='archived'").fetchone())

    def test_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'empty.json'
            p.write_text(json.dumps({'threadName': 'Empty_1', 'participants': ['Me'], 'messages': []}))
            conn = sqlite3.connect(':memory:')
            conn.executescript(SCHEMA_SQL)
            self.assertEqual(ingest_e2e(conn.cursor(), p), (0, 0))
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM threads').fetchone()[0], 0)

    def test_archive_detection_and_media(self):
        import zipfile
        from lib.archives import extract_archives_found_with_opts
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'secure.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('Person_1.json', json.dumps({'threadName': 'Person_1', 'participants': ['Me', 'Person'], 'messages': []}))
                z.writestr('media/image.jpeg', b'image')
            count, detected, _ = extract_archives_found_with_opts([], root / 'workspace', explicit_archives=[archive])
            self.assertEqual(count, 1)
            self.assertEqual(detected, {'facebook'})
            self.assertTrue((root / 'workspace/Facebook/your_facebook_activity/e2e/media/image.jpeg').exists())
            self.assertTrue(archive.exists())
