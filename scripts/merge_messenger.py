"""Enrich confidently matched archive rows. Dry run unless --apply is supplied.

Reapply after rebuilding the archive database. Unmatched rows are never inserted.
"""
import argparse
import collections
import datetime
import json
import sqlite3
from pathlib import Path


def plan(conn, data, thread_id):
    names = {p['id']: p.get('name') for p in data['participants']}
    buckets = collections.defaultdict(list)
    for row in conn.execute('SELECT id,sender_name,timestamp_ms,content,share_json FROM content WHERE thread_id=?', (thread_id,)):
        buckets[(row[1], row[2] // 1000, row[3] or '')].append(row)
    matches = {}
    claims = collections.Counter()
    for message in data['messages']:
        if message.get('isUnsent') or int(message['timestampMs']) <= 0:
            continue
        rows = buckets.get((names.get(message['senderId']), int(message['timestampMs']) // 1000, message.get('text') or ''), [])
        if len(rows) == 1:
            matches[message['id']] = rows[0]
            claims[rows[0][0]] += 1
    matches = {key: row for key, row in matches.items() if claims[row[0]] == 1}
    updates = []
    conflicts = 0
    for message in data['messages']:
        row = matches.get(message['id'])
        if row is None:
            continue
        share = json.loads(row[4] or '{}')
        if not isinstance(share, dict):
            conflicts += 1
            continue
        metadata = {'message_id': message['id'], 'sender_id': message['senderId']}
        reply = message.get('replyTo')
        if reply:
            metadata['reply_to_message_id'] = reply['messageId']
            original = matches.get(reply['messageId'])
            if original:
                quote = {'creator': original[1], 'text': original[3] or ''}
                if share.get('quoted_message') not in (None, quote):
                    conflicts += 1
                    continue
                share['quoted_message'] = quote
                metadata['reply_to_content_id'] = original[0]
        if share.get('messenger') not in (None, metadata):
            conflicts += 1
            continue
        share['messenger'] = metadata
        encoded = json.dumps(share, ensure_ascii=False)
        if encoded != row[4]:
            updates.append((encoded, row[0]))
    return updates, {'source_records': len(data['messages']), 'matched': len(matches),
                     'unmatched_or_ambiguous': len(data['messages']) - len(matches),
                     'updates': len(updates), 'conflicts': conflicts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--db', type=Path, default=Path('data/messagehub.db'))
    parser.add_argument('--thread-id', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    data = json.loads(args.source.read_text())
    if data.get('format') != 'messagehub-messenger-investigation':
        raise ValueError('Unsupported export format')
    conn = sqlite3.connect(f'file:{args.db.resolve()}?mode=rw', uri=True)
    if conn.execute('SELECT platform FROM threads WHERE id=?', (args.thread_id,)).fetchone() != ('facebook',):
        raise ValueError('Select an existing Facebook thread')
    updates, report = plan(conn, data, args.thread_id)
    if args.apply:
        backup = args.db.with_name(args.db.name + '.before-messenger-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
        with sqlite3.connect(backup) as target:
            conn.backup(target)
        with conn:
            # Recompute under a write lock so concurrent changes cannot be overwritten.
            conn.execute('BEGIN IMMEDIATE')
            updates, report = plan(conn, data, args.thread_id)
            conn.executemany('UPDATE content SET share_json=? WHERE id=?', updates)
        report['backup'] = str(backup)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
