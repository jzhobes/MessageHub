#!/usr/bin/env python3
"""Build the same fictional export archives each time from samples/source/conversations.txt."""

import html
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.policy import default
from email.utils import format_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
PEOPLE = dict(M="Alex Smith", L="Emma Wilson", T="Ben Miller", J="Sam Park",
              R="David Smith", A="Susan Smith", E="James Turner", N="Sarah Brown", S="Chris Taylor")
OWNER = PEOPLE["M"]
PLATFORMS = ("facebook", "instagram", "google_chat", "google_voice", "google_mail")


def address(name):
    return name.lower().replace(" ", ".") + "@example.com"


def read_stories():
    stories = []
    story = timestamp = attachment = None
    source = SAMPLES / "source/conversations.txt"
    for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
        if attachment and (line.startswith(("## ", "@ ", "# attachment: "))):
            raise ValueError(f"{source}:{number}: attachment {attachment!r} has no message")
        if line.startswith("## "):
            platform, slug, title, members = line[3:].split(" | ")
            if platform not in PLATFORMS:
                raise ValueError(f"{source}:{number}: unsupported platform {platform!r}")
            story = dict(platform=platform, slug=slug, title=title,
                         members=[PEOPLE.get(p, p) for p in members.split(",")], messages=[])
            stories.append(story)
            timestamp = None
        elif line.startswith("@ "):
            timestamp = datetime.strptime(line[2:], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        elif line.startswith("# attachment: "):
            attachment = line.removeprefix("# attachment: ").strip()
            if not attachment:
                raise ValueError(f"{source}:{number}: attachment marker needs a filename")
        elif line and not line.startswith("#"):
            sender, text = line.split(": ", 1)
            sender = PEOPLE.get(sender, sender)
            if story is None or timestamp is None or (sender != OWNER and sender not in story["members"]):
                raise ValueError(f"{source}:{number}: message needs a thread, date and valid sender")
            story["messages"].append(dict(sender=sender, text=text, timestamp=timestamp, attachment=attachment))
            attachment = None
            timestamp += timedelta(seconds=83)
    if attachment:
        raise ValueError(f"{source}: attachment {attachment!r} has no message")
    return stories


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode()


def card(title, lines):
    """Draw a note we can use as a real attachment in the sample."""
    rows = ''.join(f'<text x="48" y="{155 + i * 42}" font-size="23">{html.escape(s)}</text>'
                   for i, s in enumerate(lines))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500">'
            '<rect width="900" height="500" fill="#f6f3eb"/>'
            '<path d="M0 0H900V24H0Z" fill="#386b59"/>'
            '<g fill="#243a33" font-family="sans-serif">'
            f'<text x="48" y="92" font-size="36">{html.escape(title)}</text>{rows}'
            '<text x="48" y="460" font-size="16">Fictional MessageHub demo attachment</text></g></svg>').encode()


def build():
    stories = read_stories()
    bundles = {p: {} for p in PLATFORMS}
    bundles['facebook']['personal_information/profile_information/profile_information.json'] = json_bytes(
        {'profile_v2': {'name': {'full_name': OWNER, 'first_name': 'Alex', 'last_name': 'Smith'},
                        'emails': {'emails': [address(OWNER)]}}})
    bundles['instagram']['personal_information/personal_information/personal_information.json'] = json_bytes(
        {'profile_user': [{'string_map_data': {'Name': {'value': OWNER}, 'Username': {'value': 'alex.smith.demo'}}}]})
    bundles['google_chat']['Takeout/Google Chat/Users/User Alex Smith/user_info.json'] = json_bytes({'user': {'name': OWNER, 'email': address(OWNER)}})
    bundles['google_voice']['Takeout/Voice/Phones.vcf'] = (
        'BEGIN:VCARD\nVERSION:3.0\nFN:Alex Smith\nitem1.TEL:+12025550100\nitem1.X-ABLabel:Google Voice\nEND:VCARD\n').encode()
    attachments = {
        'weekend-plan.svg': card('Fern House weekend', [
            'March 14–16, 2025 · Millbrook', 'Friday: pickup 1 PM · check-in after 4 PM',
            '18 Fern Lane · driveway after the red mailbox', 'Saturday: Cedar Loop · 3 miles', 'Sunday: checkout by 11 AM']),
        'concert-plan.svg': card('Saturday on Canal Road', [
            'May 17 · dinner at 6 PM', 'Nori Kitchen · 14 Canal Road', 'Lantern Hall · 9 Canal Road',
            'Doors 7 PM · music 8 PM', 'Three balcony tickets · reference LH517']),
        'signup-review.svg': card('Signup review · narrow screen', [
            'Spring neighborhood planting workshop', 'Issue: event title clips on confirmation screen',
            'Expected: full title wraps onto another line', 'Keep long titles in the review examples']),
    }
    expected_attachments = set(attachments) | {'receipt-W4821.txt', 'return-R219.svg'}
    seen_attachments = set()
    mail = []
    for index, story in enumerate(stories, 1):
        platform, slug = story['platform'], story['slug']
        bundle = bundles[platform]
        members = list(dict.fromkeys([OWNER] + story['members']))
        for message in story['messages']:
            filename = message['attachment']
            if filename is None:
                continue
            supported = expected_attachments - attachments.keys() if platform == 'google_mail' else (
                attachments.keys() if platform != 'google_voice' else ()
            )
            if filename not in supported or filename in seen_attachments:
                raise ValueError(f'{slug}: invalid or duplicate attachment {filename!r}')
            seen_attachments.add(filename)
        if platform in ('facebook', 'instagram'):
            base = f'your_{platform}_activity/messages/inbox/{slug}_{index}'
            messages = []
            for i, m in enumerate(story['messages']):
                row = dict(sender_name=m['sender'], timestamp_ms=int(m['timestamp'].timestamp() * 1000),
                           content=m['text'], is_geoblocked_for_viewer=False)
                # Add a few reactions from people in the thread. That's enough to show how they look.
                if len(members) > 1 and i % 11 == 5:
                    actor = next(p for p in members if p != m['sender'])
                    row['reactions'] = [{'reaction': '❤', 'actor': actor}]
                if filename := m['attachment']:
                    data = attachments[filename]
                    uri = f'messages/inbox/{slug}_{index}/files/{filename}'
                    row['files'] = [{'uri': uri}]
                    bundle[f'your_{platform}_activity/{uri}'] = data
                messages.append(row)
            bundle[f'{base}/message_1.json'] = json_bytes(dict(
                participants=[{'name': p} for p in members], messages=list(reversed(messages)),
                title=story['title'], is_still_participant=True, thread_path=f'inbox/{slug}_{index}', magic_words=[]))
        elif platform == 'google_chat':
            base = f'Takeout/Google Chat/Groups/{slug}'
            messages = []
            for m in story['messages']:
                row = dict(creator={'name': m['sender'], 'email': address(m['sender']), 'user_type': 'Human'},
                           created_date=m['timestamp'].isoformat(), text=m['text'], topic_id=f'{slug}-{m["timestamp"].date()}')
                if filename := m['attachment']:
                    data = attachments[filename]
                    row['attached_files'] = [{'export_name': filename}]
                    bundle[f'{base}/{filename}'] = data
                messages.append(row)
            bundle[f'{base}/messages.json'] = json_bytes({'messages': messages})
            bundle[f'{base}/group_info.json'] = json_bytes({'name': story['title'], 'members': [{'name': p} for p in members]})
        elif platform == 'google_voice':
            for m in story['messages']:
                ts = m['timestamp'].isoformat()
                sender = 'Me' if m['sender'] == OWNER else m['sender']
                phone = {'Me': '+12025550100', 'Susan Smith': '+12025550101',
                         'David Smith': '+12025550102', 'Emma Wilson': '+12025550103'}.get(sender)
                if phone is None:
                    raise ValueError(f'{slug}: no fictional phone number assigned to {sender!r}')
                filename = f'{slug} - Text - {m["timestamp"].strftime("%Y-%m-%dT%H_%M_%SZ")}.html'
                bundle[f'Takeout/Voice/Calls/{filename}'] = (
                    '<html><head><meta charset="utf-8"></head><body><div class="hChatLog hfeed">'
                    f'<div class="message"><abbr class="dt" title="{ts}">{ts}</abbr>'
                    f'<cite class="sender vcard"><a class="tel" href="tel:{phone}"><span class="fn">{html.escape(sender)}</span></a></cite>'
                    f'<q>{html.escape(m["text"])}</q></div></div></body></html>').encode()
        elif platform == 'google_mail':
            for i, m in enumerate(story['messages']):
                msg = EmailMessage(policy=default)
                msg['From'] = f'{m["sender"]} <{address(m["sender"])}>'
                recipients = [p for p in members if p != OWNER] if m['sender'] == OWNER else [OWNER]
                msg['To'] = ', '.join(f'{p} <{address(p)}>' for p in recipients)
                msg['Subject'] = ('Re: ' if i else '') + story['title']
                msg['Date'] = format_datetime(m['timestamp'])
                msg['Message-ID'] = f'<{slug}-{i}@example.com>'
                msg['X-GM-THRID'] = str(8000 + index)
                msg['X-Gmail-Labels'] = 'Sent' if m['sender'] == OWNER else 'Inbox'
                if m['sender'] != OWNER:
                    msg['Delivered-To'] = address(OWNER)
                if i:
                    msg['In-Reply-To'] = f'<{slug}-{i-1}@example.com>'
                    msg['References'] = f'<{slug}-0@example.com>'
                msg.set_content(m['text'])
                msg.add_alternative('<html><body><p>' + html.escape(m['text']) + '</p></body></html>', subtype='html')
                if m['attachment'] == 'receipt-W4821.txt':
                    msg.add_attachment(b'Fictional demo receipt\nOrder W4821\nCompact wired keyboard: $64\nShipping: $6\nTotal paid: $70\n', maintype='text', subtype='plain', filename='receipt-W4821.txt')
                if m['attachment'] == 'return-R219.svg':
                    msg.add_attachment(card('Return R219 · order W4821', ['Demo return label · not valid for postage', 'Compact wired keyboard', 'Refund including shipping: $70']), maintype='image', subtype='svg+xml', filename='return-R219.svg')
                # Escape body lines the way mbox expects. Keep the bytes deterministic and leave MIME boundaries intact.
                if msg.is_multipart():
                    for part_index, part in enumerate(msg.walk()):
                        if part.is_multipart():
                            part.set_boundary(f'messagehub-{slug}-{i}-{part_index}')
                raw = re.sub(br'(?m)^From ', b'>From ', msg.as_bytes())
                mail.append(b'From demo@example.com ' + m['timestamp'].strftime('%a %b %d %H:%M:%S %Y').encode() + b'\n' + raw + b'\n\n')
    if missing := expected_attachments - seen_attachments:
        raise ValueError(f'Missing attachment markers: {sorted(missing)}')
    bundles['google_mail']['Takeout/Mail/sample.mbox'] = b''.join(mail)
    for platform, entries in bundles.items():
        with zipfile.ZipFile(SAMPLES / f'{platform}_sample.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(entries.items()):
                info = zipfile.ZipInfo(name, date_time=(2025, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
    print(f'Built {len(stories)} conversations, {sum(len(s["messages"]) for s in stories)} messages across five archives.')


if __name__ == '__main__':
    build()
