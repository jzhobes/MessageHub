import { describe, expect, it } from 'vitest';

import {
  filterMessagesBySelectedDays,
  getSelfLabel,
  isMarkdownSystemMessage,
  MarkdownExportBuilder,
} from '@/lib/server/dataset/builders/MarkdownExportBuilder';
import { DaySummaryStat, selectBestDays } from '@/lib/server/dataset/sampleThreadDays';

describe('MarkdownExportBuilder', () => {
  it('derives self label preferring a real name over Me, phone numbers, and emails', () => {
    expect(getSelfLabel(['Me', '+16175551234', 'john@example.com', 'John Ho'])).toBe('John Ho (self)');
    expect(getSelfLabel(['John', 'Me'])).toBe('John (self)');
    expect(getSelfLabel([])).toBe('Self (self)');
  });

  it('detects Messenger system notices accurately', () => {
    expect(isMarkdownSystemMessage('You pinned a message.')).toBe(true);
    expect(isMarkdownSystemMessage('YELLOW RANGER reacted 👆 to your message')).toBe(true);
    expect(isMarkdownSystemMessage('Alice added Bob to the group.')).toBe(true);
    expect(isMarkdownSystemMessage('k')).toBe(false);
    expect(isMarkdownSystemMessage('lol yeah i pinned it')).toBe(false);
  });

  it('preserves midnight-rollover continuity when filtering by selected days', () => {
    const msgs = [
      { timestamp_ms: Date.parse('2026-11-15T23:50:00Z'), content: 'late night msg' },
      { timestamp_ms: Date.parse('2026-11-16T00:08:00Z'), content: 'crossed midnight reply' },
      { timestamp_ms: Date.parse('2026-11-16T14:00:00Z'), content: 'next afternoon unrelated' },
    ];
    const kept = filterMessagesBySelectedDays(msgs, ['2026-11-15'], 'UTC');
    expect(kept.map((m) => m.content)).toEqual(['late night msg', 'crossed midnight reply']);
  });

  it.each(['sample-group-messages', 'sample-group-messages.md', 'sample-group-messages.MD'])(
    'uses the chosen filename without category suffixes: %s',
    (datasetName) => {
      const builder = new MarkdownExportBuilder({
        datasetName,
        identityNames: ['John'],
        includeReactions: false,
        removeSystemMessages: false,
        redactPII: false,
        timeZone: 'UTC',
      });
      builder.addChatThread({
        threadId: 'group',
        title: 'Friends',
        platform: 'facebook',
        isGroup: true,
        participants: ['John'],
        messages: [{ sender_name: 'John', content: 'Hello', timestamp_ms: 1 }],
      });
      const files = builder.finalize(false);
      expect(files).toHaveLength(1);
      expect(files[0].fileName).toBe('sample-group-messages.md');
    },
  );

  it('formats group chats, DMs, posts, emails, events, and summary cleanly', () => {
    const builder = new MarkdownExportBuilder({
      datasetName: 'virtual_me',
      identityNames: ['Me', 'John'],
      includeReactions: true,
      removeSystemMessages: true,
      redactPII: true,
      timeZone: 'UTC',
    });

    builder.addChatThread({
      threadId: 'g1',
      title: 'SPOOKY FRIDAYS',
      platform: 'Facebook',
      isGroup: true,
      participants: ['John', 'Alex', 'Jeff'],
      messages: [
        {
          sender_name: 'Alex',
          content: "Who's down for Japan?",
          timestamp_ms: Date.parse('2026-11-15T23:55:00Z'),
        },
        {
          sender_name: 'John',
          content: 'You pinned a message.',
          timestamp_ms: Date.parse('2026-11-15T23:56:00Z'),
        },
        {
          sender_name: 'John',
          content: 'k',
          timestamp_ms: Date.parse('2026-11-15T23:57:00Z'),
          share_json: JSON.stringify({
            quoted_message: { creator: { name: 'Alex' }, text: "Who's down for Japan?" },
          }),
          reactions_json: JSON.stringify([{ actor: 'Jeff', reaction: '😂' }]),
        },
        {
          sender_name: 'John',
          content: 'call me at 555-123-4567',
          timestamp_ms: Date.parse('2026-11-16T00:05:00Z'),
        },
        {
          sender_name: 'Jeff',
          content: 'Jeff unsent a message.',
          timestamp_ms: Date.parse('2026-11-16T00:06:00Z'),
        },
      ],
    });

    builder.addChatThread({
      threadId: 'd1',
      title: 'Dylan',
      platform: 'Facebook',
      isGroup: false,
      participants: ['John', 'Dylan'],
      messages: [
        {
          sender_name: 'Dylan',
          content: 'still on for 2?',
          timestamp_ms: Date.parse('2026-11-14T11:20:00Z'),
        },
        {
          sender_name: 'John',
          content: 'yep',
          timestamp_ms: Date.parse('2026-11-14T11:21:00Z'),
          media_json: JSON.stringify([{ type: 'photo', uri: '/photos/IMG_123.jpg' }]),
        },
      ],
    });

    builder.addPosts({
      messages: [
        {
          sender_name: 'John',
          content: 'Happy birthday!',
          timestamp_ms: Date.parse('2026-10-01T12:00:00Z'),
        },
        {
          sender_name: 'John',
          content: 'Best ramen all year.',
          thread_title: 'Shared a photo',
          timestamp_ms: Date.parse('2026-10-14T19:22:00Z'),
        },
      ],
    });

    builder.addEmailThread({
      threadId: 'e1',
      subject: 'Project Sync',
      platform: 'Gmail',
      participants: ['John', 'Sam'],
      messages: [
        {
          sender_name: 'John',
          content: 'Following up on the roadmap.\n\nOn Mon, Sam wrote:\n> Old quoted text',
          timestamp_ms: Date.parse('2026-11-10T15:00:00Z'),
        },
      ],
    });

    builder.addEventRecord('Joined Event', Date.parse('2026-11-01T18:00:00Z'), 'facebook', 'Ramen Fest');

    const files = builder.finalize(true);
    const byName = new Map(files.map((f) => [f.fileName, f.content]));

    expect(Array.from(byName.keys())).toEqual(['virtual_me.md', 'virtual_me-summary.md']);

    const groupMd = byName.get('virtual_me.md')!;
    expect(groupMd).toContain('type: message_samples');
    expect(groupMd).toContain('self_label: John (self)');
    expect(groupMd).toContain('# Group: SPOOKY FRIDAYS');
    expect(groupMd).toContain('## Conversation: 2026-11-15 | SPOOKY FRIDAYS');
    expect(groupMd).not.toContain('You pinned a message.');
    expect(groupMd).toContain('[Replying to Alex: "Who\'s down for Japan?"]');
    expect(groupMd).toContain('\nk\n');
    expect(groupMd).toContain('[Reactions: Jeff 😂]');
    // Keep this as one conversation across midnight and show a full date header.
    expect(groupMd).toContain('**2026-11-16 00:05 | John (self):**');
    expect(groupMd).not.toContain('555-123-4567');
    expect(groupMd).toContain('[Deleted message]');

    const dmMd = byName.get('virtual_me.md')!;
    expect(dmMd).toContain('# DM: Dylan');
    expect(dmMd).toContain('[Image attachment: IMG_123.jpg]');

    const postsMd = byName.get('virtual_me.md')!;
    expect(postsMd).not.toContain('Happy birthday!');
    expect(postsMd).toContain('Best ramen all year.');
    expect(postsMd).toContain('*Context: Shared a photo*');

    const emailsMd = byName.get('virtual_me.md')!;
    expect(emailsMd).toContain('# Subject: Project Sync');
    expect(emailsMd).toContain('Following up on the roadmap.');
    expect(emailsMd).not.toContain('Old quoted text');

    const eventsMd = byName.get('virtual_me.md')!;
    expect(eventsMd).toContain('# Events');
    expect(eventsMd).toContain('Ramen Fest');

    const summaryMd = byName.get('virtual_me-summary.md')!;
    expect(summaryMd).toContain('SPOOKY FRIDAYS');
    expect(summaryMd).toContain('virtual_me.md');
  });
});

describe('selectBestDays heuristic', () => {
  it('prefers diverse months and balanced back-and-forth days up to ~100 messages', () => {
    const days: DaySummaryStat[] = [
      {
        date: '2026-11-15',
        totalMsgs: 35,
        myMsgs: 15,
        otherMsgs: 20,
        uniqueSpeakers: 4,
        reactionCount: 6,
        avgMyLen: 45,
        maxTs: Date.parse('2026-11-15T20:00:00Z'),
        score: 0,
      },
      {
        date: '2026-11-16',
        totalMsgs: 34,
        myMsgs: 14,
        otherMsgs: 20,
        uniqueSpeakers: 4,
        reactionCount: 5,
        avgMyLen: 42,
        maxTs: Date.parse('2026-11-16T20:00:00Z'),
        score: 0,
      },
      {
        date: '2026-09-10',
        totalMsgs: 32,
        myMsgs: 14,
        otherMsgs: 18,
        uniqueSpeakers: 3,
        reactionCount: 4,
        avgMyLen: 40,
        maxTs: Date.parse('2026-09-10T20:00:00Z'),
        score: 0,
      },
      {
        date: '2026-06-05',
        totalMsgs: 30,
        myMsgs: 12,
        otherMsgs: 18,
        uniqueSpeakers: 3,
        reactionCount: 3,
        avgMyLen: 38,
        maxTs: Date.parse('2026-06-05T20:00:00Z'),
        score: 0,
      },
    ];

    const picked = selectBestDays(days, { isChat: true, targetMessages: 100 });
    // Pick days across June, September, and November so adjacent November days don't take two spots.
    expect(picked).toEqual(['2026-06-05', '2026-09-10', '2026-11-15']);
  });
});
