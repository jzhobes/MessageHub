"""Correlate explicit Marketplace conversation records with imported message threads."""
import json
from pathlib import Path

from utils import fix_text


def fields(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from fields(child)
    elif isinstance(value, list):
        for child in value:
            yield from fields(child)


def ingest_marketplace(cursor, path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(data, list):
        raise ValueError('Marketplace conversations must be a list')
    for record in data:
        entries = list(fields(record))
        title = next((fix_text(x.get('value')) for x in entries if x.get('label') == 'Product title'), None)
        people = sorted({fix_text(x['value']) for x in entries if x.get('label') == 'Name' and x.get('value')})
        if title and len(people) == 2:
            cursor.execute('INSERT OR IGNORE INTO facebook_marketplace_conversations VALUES (?,?)',
                           (title, json.dumps(people, ensure_ascii=False)))


def reconcile_marketplace(cursor):
    records = {(title, tuple(json.loads(people))) for title, people in cursor.execute(
        'SELECT product_title, participants_json FROM facebook_marketplace_conversations')}
    matched = 0
    for thread, title, people in cursor.execute(
            "SELECT id,title,participants_json FROM threads WHERE platform='facebook'").fetchall():
        if not title or ' · ' not in title:
            continue
        key = (title.split(' · ', 1)[1], tuple(sorted(json.loads(people or '[]'))))
        if key in records:
            # Both matching threads are Marketplace conversations even if the export omits their IDs.
            cursor.execute("INSERT OR IGNORE INTO thread_labels VALUES (?, 'marketplace')", (thread,))
            matched += 1
    return matched
