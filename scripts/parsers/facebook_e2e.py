"""Import Messenger secure-storage exports. They don't come with stable thread IDs."""
import hashlib
import json
import re
from pathlib import Path

from utils import get_media_type


def is_e2e_document(data):
    return (isinstance(data, dict) and isinstance(data.get('threadName'), str)
            and isinstance(data.get('messages'), list) and isinstance(data.get('participants'), list)
            and all(isinstance(p, str) for p in data['participants']))


def ingest_e2e(cursor, source):
    data = json.loads(Path(source).read_text())
    if not is_e2e_document(data) or not data['messages']:
        return 0, 0
    messages = data['messages']
    participants = sorted(set(data['participants']))
    title = re.sub(r'_\d+$', '', data['threadName'])
    first = min(m['timestamp'] for m in messages)
    # The same history keeps its ID even if the filename changes.
    seed = json.dumps([participants, title, first], ensure_ascii=False)
    thread_id = 'fb-e2e-' + hashlib.sha256(seed.encode()).hexdigest()[:24]
    candidates = []
    for row in cursor.execute("SELECT id, participants_json FROM threads WHERE platform='facebook'").fetchall():
        candidate, people = row[0], json.loads(row[1] or '[]')
        if sorted(people) != participants:
            continue
        labels = {r[0] for r in cursor.execute('SELECT label FROM thread_labels WHERE thread_id=?', (candidate,))}
        if 'e2e' not in labels and 'e2ee_cutover' in labels and len(participants) == 2:
            senders = {r[0] for r in cursor.execute('SELECT DISTINCT sender_name FROM content WHERE thread_id=?', (candidate,))}
            last = cursor.execute('SELECT MAX(timestamp_ms) FROM content WHERE thread_id=?', (candidate,)).fetchone()[0]
            if senders <= set(participants) and last is not None and last < first:
                candidates.append(candidate)
        elif 'e2e' in labels:
            # Use message overlap to match partial exports or histories whose names or suffixes changed.
            if any(cursor.execute('SELECT 1 FROM content WHERE thread_id=? AND sender_name=? AND timestamp_ms=? AND content IS ? LIMIT 1',
                                  (candidate, m['senderName'], m['timestamp'], ('[Deleted message]' if m.get('isUnsent') else m.get('text') or ''))).fetchone()
                   for m in messages):
                candidates.append(candidate)
    if len(set(candidates)) == 1:
        thread_id = candidates[0]
    cursor.execute('INSERT INTO threads (id,platform,title,participants_json,is_group) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
                   (thread_id, 'facebook', title, json.dumps(participants), len(participants) > 2))
    for label in ('message', 'e2e'):
        cursor.execute('INSERT OR IGNORE INTO thread_labels VALUES (?,?)', (thread_id, label))
    count = 0
    for m in messages:
        media = []
        for item in m.get('media', []):
            uri = item.get('uri', '')
            if uri.startswith('./'):
                uri = uri[2:]
            if uri.startswith('/') or '..' in Path(uri).parts:
                continue
            media.append({'uri': 'your_facebook_activity/e2e/' + uri, 'type': get_media_type(uri)})
        text = '[Deleted message]' if m.get('isUnsent') else (m.get('text') or '')
        cursor.execute('INSERT OR IGNORE INTO content (thread_id,sender_name,timestamp_ms,content,media_json,reactions_json) VALUES (?,?,?,?,?,?)',
                       (thread_id, m['senderName'], m['timestamp'], text, json.dumps(media) if media else None,
                        json.dumps(m.get('reactions')) if m.get('reactions') else None))
        count += cursor.rowcount
    latest = cursor.execute('SELECT sender_name,timestamp_ms,content FROM content WHERE thread_id=? ORDER BY timestamp_ms DESC LIMIT 1', (thread_id,)).fetchone()
    cursor.execute('UPDATE threads SET last_activity_ms=?,snippet=? WHERE id=?',
                   (latest[1], f'{latest[0]}: {latest[2]}' if latest[2] else f'{latest[0]} sent an attachment', thread_id))
    return count, len(messages) - count


def reconcile_cutovers(cursor):
    """Link E2E histories we've already imported when the standard export comes in later."""
    rows = cursor.execute("SELECT t.id,t.participants_json FROM threads t JOIN thread_labels l ON l.thread_id=t.id WHERE l.label='e2e' AND t.id LIKE 'fb-e2e-%'").fetchall()
    for source, people in rows:
        participants = json.loads(people)
        if len(participants) != 2:
            continue
        first = cursor.execute('SELECT MIN(timestamp_ms) FROM content WHERE thread_id=?', (source,)).fetchone()[0]
        candidates = []
        for target, target_people in cursor.execute("SELECT t.id,t.participants_json FROM threads t JOIN thread_labels l ON l.thread_id=t.id WHERE l.label='e2ee_cutover'").fetchall():
            if sorted(json.loads(target_people)) != sorted(participants):
                continue
            last = cursor.execute('SELECT MAX(timestamp_ms) FROM content WHERE thread_id=?', (target,)).fetchone()[0]
            senders = {r[0] for r in cursor.execute('SELECT DISTINCT sender_name FROM content WHERE thread_id=?', (target,))}
            if first and last and last < first and senders <= set(participants):
                candidates.append(target)
        if len(candidates) != 1:
            continue
        target = candidates[0]
        cursor.execute('UPDATE OR IGNORE content SET thread_id=? WHERE thread_id=?', (target, source))
        cursor.execute('DELETE FROM content WHERE thread_id=?', (source,))
        cursor.execute("INSERT OR IGNORE INTO thread_labels VALUES (?, 'e2e')", (target,))
        cursor.execute('UPDATE threads SET last_activity_ms=(SELECT last_activity_ms FROM threads WHERE id=?), snippet=(SELECT snippet FROM threads WHERE id=?) WHERE id=?', (source, source, target))
        cursor.execute('DELETE FROM thread_labels WHERE thread_id=?', (source,))
        cursor.execute('DELETE FROM threads WHERE id=?', (source,))
