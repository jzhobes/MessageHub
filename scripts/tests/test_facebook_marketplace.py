import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.db_ops import SCHEMA_SQL
from parsers.facebook_marketplace import ingest_marketplace, reconcile_marketplace


class MarketplaceTests(unittest.TestCase):
    def test_records_survive_until_threads_arrive(self):
        db = sqlite3.connect(':memory:')
        db.executescript(SCHEMA_SQL)
        c = db.cursor()
        record = [{'label_values': [{'label': 'Product title', 'value': 'Camera'},
                                    {'title': 'Buyer', 'dict': [{'label': 'Name', 'value': 'Buyer'}]},
                                    {'title': 'Seller', 'dict': [{'label': 'Name', 'value': 'Me'}]}]}]
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'conversations_you_had_as_a_buyer.json'
            p.write_text(json.dumps(record))
            ingest_marketplace(c, p)
            ingest_marketplace(c, p)
        self.assertEqual(reconcile_marketplace(c), 0)
        for ident, title in [('match', 'Buyer · Camera'), ('personal', 'Buyer'), ('wrong', 'Buyer · Chair')]:
            c.execute('INSERT INTO threads (id,platform,title,participants_json) VALUES (?,?,?,?)',
                      (ident, 'facebook', title, json.dumps(['Me', 'Buyer'])))
        self.assertEqual(reconcile_marketplace(c), 1)
        self.assertEqual(reconcile_marketplace(c), 1)
        self.assertEqual(c.execute("SELECT thread_id FROM thread_labels WHERE label='marketplace'").fetchall(), [('match',)])
