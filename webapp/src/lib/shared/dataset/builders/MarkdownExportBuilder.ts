import { stripCommonEmailBoilerplate, stripQuotedHistory } from '@/lib/shared/dataset/builders/EmailPairBuilder';
import { EventRecordBuilder } from '@/lib/shared/dataset/builders/EventRecordBuilder';
import { redactPII, redactTrackingNumbers } from '@/lib/shared/piiUtils';
import { containsHtmlOrEntities, stripHtml } from '@/lib/shared/stringUtils';

function getBaseName(rawPath: string): string {
  const clean = rawPath.split('?')[0].split('#')[0].replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function getExtName(baseName: string): string {
  const idx = baseName.lastIndexOf('.');
  if (idx <= 0) {
    return '';
  }
  return baseName.slice(idx).toLowerCase();
}

export interface MarkdownMessageRow {
  id?: number | string;
  sender_name: string | null;
  content: string | null;
  timestamp_ms: number;
  media_json?: string | null;
  reactions_json?: string | null;
  share_json?: string | null;
  annotations_json?: string | null;
  thread_title?: string | null;
}

export interface MarkdownExportOptions {
  datasetName: string;
  identityNames: string[];
  includeReactions: boolean;
  removeSystemMessages: boolean;
  redactPII: boolean;
  timeZone?: string;
}

export interface MarkdownChatInput {
  threadId: string;
  title: string;
  platform: string;
  isGroup: boolean;
  participants: string[];
  messages: MarkdownMessageRow[];
  selectedDays?: string[];
}

export interface MarkdownPostInput {
  messages: MarkdownMessageRow[];
  selectedDays?: string[];
}

export interface MarkdownEmailInput {
  threadId: string;
  subject: string;
  platform: string;
  participants: string[];
  messages: MarkdownMessageRow[];
  selectedDays?: string[];
}

export interface MarkdownFileOutput {
  fileName: string;
  content: string;
}

interface SummaryThreadStat {
  fileName: string;
  title: string;
  platform: string;
  selfMessages: number;
  totalMessages: number;
  minDate: string;
  maxDate: string;
}

const PHONE_REGEX = /^\+?[\d\s\-()]{7,}$/;

/**
 * Derives a human-readable `<PrimaryName> (self)` label from the configured identity names,
 * preferring the first entry that is not `"Me"`, an email address, or a phone number.
 */
export function getSelfLabel(identityNames: string[]): string {
  const cleaned = identityNames.map((n) => n.trim()).filter(Boolean);
  const preferred = cleaned.find((n) => n.toLowerCase() !== 'me' && !n.includes('@') && !PHONE_REGEX.test(n));
  const base = preferred || cleaned[0] || 'Self';
  return `${base} (self)`;
}

/**
 * Formats a Unix millisecond timestamp as a local `YYYY-MM-DD` date key.
 */
export function formatDateKey(timestampMs: number, timeZone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date(timestampMs));
  } catch {
    const d = new Date(timestampMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/**
 * Formats a Unix millisecond timestamp as local 24-hour `HH:mm`.
 */
export function formatTimeHHmm(timestampMs: number, timeZone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const formatted = formatter.format(new Date(timestampMs));
    return formatted.startsWith('24:') ? `00:${formatted.slice(3)}` : formatted;
  } catch {
    const d = new Date(timestampMs);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function getLocalHour(timestampMs: number, timeZone?: string): number {
  const hhmm = formatTimeHHmm(timestampMs, timeZone);
  return parseInt(hhmm.slice(0, 2), 10) || 0;
}

function getPreviousDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Detects automated platform/admin system notices that should be excluded when
 * `removeSystemMessages` is enabled.
 */
export function isMarkdownSystemMessage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === 'MMS Sent') {
    return true;
  }
  const patterns = [
    /^.* named the group .*$/i,
    /^.* changed the group (name|photo).*$/i,
    /^.* added .* to the group\.?$/i,
    /^.* removed .* from the group\.?$/i,
    /^.* left the group\.?$/i,
    /^.* started a (video|audio) call\.?$/i,
    /^.* (joined|ended) the video (chat|call)\.?$/i,
    /^.* changed the theme.*$/i,
    /^.* set the (nickname|emoji).*$/i,
    /^.* cleared the nickname.*$/i,
    /^You missed a call from .*$/i,
    /^.* missed your call\.?$/i,
    /^You called .*$/i,
    /^.* pinned a message\.?$/i,
    /^.* unpinned a message\.?$/i,
    /^.* reacted .+ to (your|a) message\.?$/i,
    /^Only admins can send messages\.?$/i,
    /^.* is interested in an event: .*$/i,
    /^.* joined the event: .*$/i,
    /^.* created the event: .*$/i,
  ];
  return patterns.some((regex) => regex.test(trimmed));
}

export function isUnsentMessage(content: string): boolean {
  const trimmed = content.trim();
  return /unsent a message\.?$/i.test(trimmed) || /^this message was unsent\.?$/i.test(trimmed);
}

function isPlaceholderAttachmentText(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed === 'You sent an attachment.' ||
    / sent an attachment\.$/i.test(trimmed) ||
    trimmed === 'You sent a photo.' ||
    / sent a photo\.$/i.test(trimmed)
  );
}

/**
 * Filters chronological messages to the selected local calendar days while preserving
 * continuous late-night exchanges that cross midnight (up to 04:00 within a 60-minute gap).
 */
export function filterMessagesBySelectedDays<T extends { timestamp_ms: number }>(
  messages: T[],
  selectedDays: string[] | undefined,
  timeZone?: string,
): T[] {
  if (!selectedDays || selectedDays.length === 0) {
    return messages;
  }
  const daySet = new Set(selectedDays);
  const kept: T[] = [];
  let lastKeptTs = -1;
  let lastKeptDateKey = '';

  for (const msg of messages) {
    const dateKey = formatDateKey(msg.timestamp_ms, timeZone);
    if (daySet.has(dateKey)) {
      kept.push(msg);
      lastKeptTs = msg.timestamp_ms;
      lastKeptDateKey = dateKey;
      continue;
    }

    // Midnight rollover continuity: keep trailing post-midnight messages belonging to an active exchange
    if (lastKeptTs > 0) {
      const gapMs = msg.timestamp_ms - lastKeptTs;
      const localHour = getLocalHour(msg.timestamp_ms, timeZone);
      const isNextDay = getPreviousDateKey(dateKey) === lastKeptDateKey || daySet.has(getPreviousDateKey(dateKey));
      if (isNextDay && localHour < 4 && gapMs >= 0 && gapMs <= 60 * 60 * 1000) {
        kept.push(msg);
        lastKeptTs = msg.timestamp_ms;
        // Keep lastKeptDateKey pinned to the originating day so we only bridge across one midnight
      }
    }
  }

  return kept;
}

function escapeYamlValue(val: string): string {
  if (/[:#[\]{},&*?|>!'"%@`]|^\s|\s$/.test(val)) {
    return JSON.stringify(val);
  }
  return val;
}

function buildYamlFrontmatter(entries: [string, string | string[]][]): string {
  const lines = ['---'];
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${escapeYamlValue(item)}`);
      }
    } else if (value) {
      lines.push(`${key}: ${escapeYamlValue(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export class MarkdownExportBuilder {
  private readonly _datasetName: string;
  private readonly _selfLabel: string;
  private readonly _myNamesLower: Set<string>;
  private readonly _myNamesList: string[];
  private readonly _includeReactions: boolean;
  private readonly _removeSystemMessages: boolean;
  private readonly _redactPII: boolean;
  private readonly _timeZone: string;

  private readonly _groupSections: { title: string; markdown: string }[] = [];
  private readonly _dmSections: { title: string; markdown: string }[] = [];
  private readonly _emailSections: { subject: string; markdown: string }[] = [];
  private _postsMarkdown: string | null = null;
  private readonly _eventBuilder: EventRecordBuilder;
  private _eventCount = 0;
  private _eventMinDate = '';
  private _eventMaxDate = '';
  private readonly _summaryStats: SummaryThreadStat[] = [];

  constructor(opts: MarkdownExportOptions) {
    this._datasetName =
      (opts.datasetName || 'dataset')
        .trim()
        .replace(/[\\/\x00-\x1f\x7f]/g, '_')
        .replace(/(?:\.md)+$/i, '') || 'dataset';
    this._selfLabel = getSelfLabel(opts.identityNames);
    this._myNamesLower = new Set(opts.identityNames.map((n) => n.toLowerCase().trim()).filter(Boolean));
    this._myNamesList = Array.from(this._myNamesLower);
    this._includeReactions = opts.includeReactions;
    this._removeSystemMessages = opts.removeSystemMessages;
    this._redactPII = opts.redactPII;
    this._timeZone = opts.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    this._eventBuilder = new EventRecordBuilder({ identityName: opts.identityNames[0] || 'Self' });
  }

  private _isMe(senderName: string | null | undefined): boolean {
    if (!senderName) {
      return false;
    }
    const norm = senderName.toLowerCase().trim();
    if (!norm) {
      return false;
    }
    if (this._myNamesLower.has(norm)) {
      return true;
    }
    return this._myNamesList.some((myName) => myName.length >= 3 && (norm.includes(myName) || myName.includes(norm)));
  }

  private _formatSpeaker(senderName: string | null | undefined): string {
    if (this._isMe(senderName)) {
      return this._selfLabel;
    }
    return senderName?.trim() || 'Unknown';
  }

  private _formatParticipants(participants: string[], messages: MarkdownMessageRow[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];

    const addName = (name: string | null | undefined) => {
      const label = this._formatSpeaker(name);
      if (label && label !== 'Unknown' && !seen.has(label)) {
        seen.add(label);
        ordered.push(label);
      }
    };

    // Put self first if present
    for (const p of participants) {
      if (this._isMe(p)) {
        addName(p);
      }
    }
    for (const p of participants) {
      if (!this._isMe(p)) {
        addName(p);
      }
    }
    // Also capture any speakers from messages not in participants_json
    for (const m of messages) {
      addName(m.sender_name);
    }

    return ordered;
  }

  private _extractAnnotations(
    msg: MarkdownMessageRow,
    bodyText: string,
  ): { replyLine: string | null; attachmentLines: string[]; reactionsLine: string | null } {
    let replyLine: string | null = null;
    const attachmentLines: string[] = [];
    let reactionsLine: string | null = null;

    // 1. Parse share_json (quoted replies + shared links)
    if (msg.share_json) {
      try {
        const share = JSON.parse(msg.share_json);
        if (share?.quoted_message) {
          const rawCreator =
            typeof share.quoted_message.creator === 'string'
              ? share.quoted_message.creator
              : share.quoted_message.creator?.name;
          const creator = this._formatSpeaker(rawCreator);
          let snippet = typeof share.quoted_message.text === 'string' ? share.quoted_message.text.trim() : '';
          if (snippet) {
            snippet = snippet.replace(/\s+/g, ' ');
            if (this._redactPII) {
              snippet = redactPII(snippet);
            }
            if (snippet.length > 80) {
              snippet = `${snippet.slice(0, 77)}...`;
            }
            replyLine = `[Replying to ${creator}: "${snippet}"]`;
          } else {
            replyLine = `[Replying to ${creator}]`;
          }
        } else if (share?.link && typeof share.link === 'string') {
          if (!bodyText.includes(share.link)) {
            attachmentLines.push(`[Shared link: ${share.link}]`);
          }
        }
      } catch {
        // Ignore malformed share_json
      }
    }

    // 2. Parse media_json
    if (msg.media_json) {
      try {
        const media: { uri?: string; type?: string }[] = JSON.parse(msg.media_json);
        if (Array.isArray(media)) {
          for (const item of media) {
            const type = (item.type || '').toLowerCase();
            const uri = item.uri || '';
            const baseName = uri ? getBaseName(uri) : '';
            const ext = baseName ? getExtName(baseName) : '';

            if (type === 'gif' || ext === '.gif') {
              attachmentLines.push('[GIF attachment]');
            } else if (type === 'sticker') {
              attachmentLines.push('[Sticker]');
            } else if (type === 'audio' || type === 'voice' || ['.mp3', '.m4a', '.ogg', '.wav', '.aac'].includes(ext)) {
              attachmentLines.push('[Voice message]');
            } else if (type === 'video' || ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) {
              attachmentLines.push(baseName ? `[Video attachment: ${baseName}]` : '[Video attachment]');
            } else if (
              type === 'photo' ||
              type === 'image' ||
              ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic'].includes(ext)
            ) {
              attachmentLines.push(baseName ? `[Image attachment: ${baseName}]` : '[Image attachment]');
            } else if (type === 'file' || baseName) {
              attachmentLines.push(baseName ? `[File attachment: ${baseName}]` : '[Attachment]');
            }
          }
        }
      } catch {
        // Ignore malformed media_json
      }
    }

    // 3. Parse annotations_json (Google Chat image links)
    if (msg.annotations_json) {
      try {
        const annotations: { url_metadata?: { image_url?: string } }[] = JSON.parse(msg.annotations_json);
        if (Array.isArray(annotations)) {
          for (const ann of annotations) {
            if (ann?.url_metadata?.image_url) {
              const baseName = getBaseName(ann.url_metadata.image_url);
              attachmentLines.push(baseName ? `[Image attachment: ${baseName}]` : '[Image attachment]');
            }
          }
        }
      } catch {
        // Ignore malformed annotations_json
      }
    }

    // 4. Parse reactions_json
    if (this._includeReactions && msg.reactions_json) {
      try {
        const reactions: { reaction?: string; actor?: string }[] = JSON.parse(msg.reactions_json);
        if (Array.isArray(reactions) && reactions.length > 0) {
          const parts = reactions
            .filter((r) => r.reaction)
            .map((r) => {
              const actor = r.actor ? this._formatSpeaker(r.actor) : '';
              return actor ? `${actor} ${r.reaction}` : `${r.reaction}`;
            });
          if (parts.length > 0) {
            reactionsLine = `[Reactions: ${parts.join(', ')}]`;
          }
        }
      } catch {
        // Ignore malformed reactions_json
      }
    }

    return { replyLine, attachmentLines, reactionsLine };
  }

  public addChatThread(input: MarkdownChatInput): void {
    const filtered = filterMessagesBySelectedDays(input.messages, input.selectedDays, this._timeZone);
    if (filtered.length === 0) {
      return;
    }

    const participants = this._formatParticipants(input.participants, filtered);
    const headingPrefix = input.isGroup ? 'Group' : 'DM';
    const fileName = `${this._datasetName}.md`;

    const lines: string[] = [
      `# ${headingPrefix}: ${input.title}`,
      `- **Platform:** ${input.platform}`,
      `- **Participants:** ${participants.join(', ')}`,
    ];

    let currentSectionDateKey = '';
    let prevTs = -1;
    let prevDateKey = '';
    let selfCount = 0;
    let totalCount = 0;
    let minDate = '';
    let maxDate = '';

    for (const msg of filtered) {
      let rawText = msg.content ?? '';
      if (containsHtmlOrEntities(rawText)) {
        rawText = stripHtml(rawText);
      }

      if (this._removeSystemMessages && isMarkdownSystemMessage(rawText)) {
        continue;
      }

      const unsent = isUnsentMessage(rawText);
      if (unsent) {
        rawText = '';
      } else if (isPlaceholderAttachmentText(rawText)) {
        rawText = '';
      }

      if (rawText && this._redactPII) {
        rawText = redactPII(rawText);
      }

      const { replyLine, attachmentLines, reactionsLine } = this._extractAnnotations(msg, rawText);

      // If placeholder attachment text had no media_json details, preserve a generic placeholder
      if (
        !unsent &&
        !rawText.trim() &&
        attachmentLines.length === 0 &&
        isPlaceholderAttachmentText(msg.content ?? '')
      ) {
        attachmentLines.push('[Attachment]');
      }

      if (!unsent && !rawText.trim() && attachmentLines.length === 0) {
        continue;
      }

      const dateKey = formatDateKey(msg.timestamp_ms, this._timeZone);
      const timeStr = formatTimeHHmm(msg.timestamp_ms, this._timeZone);
      const gapMs = prevTs > 0 ? msg.timestamp_ms - prevTs : 0;

      // Start a new conversation section on first message, >4h break, or day change with >1h gap
      const shouldStartSection =
        prevTs < 0 || gapMs > 4 * 60 * 60 * 1000 || (dateKey !== prevDateKey && gapMs > 60 * 60 * 1000);

      if (shouldStartSection) {
        if (prevTs >= 0) {
          lines.push('', '---');
        }
        lines.push('', `## Conversation: ${dateKey} | ${input.title}`);
        currentSectionDateKey = dateKey;
      }

      const speaker = this._formatSpeaker(msg.sender_name);
      const timestampHeader = dateKey !== currentSectionDateKey ? `${dateKey} ${timeStr}` : timeStr;

      lines.push('', `**${timestampHeader} | ${speaker}:**`);
      if (replyLine) {
        lines.push(replyLine);
      }
      if (unsent) {
        lines.push('[Deleted message]');
      } else {
        for (const att of attachmentLines) {
          lines.push(att);
        }
        if (rawText.trim()) {
          lines.push(rawText.trim());
        }
      }
      if (reactionsLine) {
        lines.push(reactionsLine);
      }

      prevTs = msg.timestamp_ms;
      prevDateKey = dateKey;
      totalCount++;
      if (this._isMe(msg.sender_name)) {
        selfCount++;
      }
      if (!minDate || dateKey < minDate) {
        minDate = dateKey;
      }
      if (!maxDate || dateKey > maxDate) {
        maxDate = dateKey;
      }
    }

    if (totalCount === 0) {
      return;
    }

    const section = { title: input.title, markdown: lines.join('\n') };
    if (input.isGroup) {
      this._groupSections.push(section);
    } else {
      this._dmSections.push(section);
    }

    this._summaryStats.push({
      fileName,
      title: input.title,
      platform: input.platform,
      selfMessages: selfCount,
      totalMessages: totalCount,
      minDate,
      maxDate,
    });
  }

  public addPosts(input: MarkdownPostInput): void {
    const filtered = filterMessagesBySelectedDays(input.messages, input.selectedDays, this._timeZone);
    if (filtered.length === 0) {
      return;
    }

    const postBlocks: string[] = [];
    let count = 0;
    let minDate = '';
    let maxDate = '';
    const birthdayRegex = /^(happy birthday|hbd|happy bday|feliz cumple)/i;

    for (const msg of filtered) {
      let rawText = msg.content ?? '';
      if (containsHtmlOrEntities(rawText)) {
        rawText = stripHtml(rawText);
      }
      rawText = rawText.trim();

      if (birthdayRegex.test(rawText) && rawText.length < 20) {
        continue;
      }
      if (rawText === 'Post') {
        rawText = '';
      }
      if (rawText && this._redactPII) {
        rawText = redactPII(rawText);
      }

      const { attachmentLines, reactionsLine } = this._extractAnnotations(msg, rawText);
      if (!rawText && attachmentLines.length === 0) {
        continue;
      }

      const dateKey = formatDateKey(msg.timestamp_ms, this._timeZone);
      const timeStr = formatTimeHHmm(msg.timestamp_ms, this._timeZone);

      const blockLines: string[] = [`## Post: ${dateKey} ${timeStr}`];
      const titleContext = msg.thread_title?.trim();
      if (titleContext && titleContext !== rawText && titleContext.toLowerCase() !== 'post') {
        blockLines.push(`*Context: ${titleContext}*`);
      }
      for (const att of attachmentLines) {
        blockLines.push(att);
      }
      if (rawText) {
        blockLines.push(rawText);
      }
      if (reactionsLine) {
        blockLines.push(reactionsLine);
      }

      postBlocks.push(blockLines.join('\n'));
      count++;
      if (!minDate || dateKey < minDate) {
        minDate = dateKey;
      }
      if (!maxDate || dateKey > maxDate) {
        maxDate = dateKey;
      }
    }

    if (count === 0) {
      return;
    }

    this._postsMarkdown = postBlocks.join('\n\n---\n\n');
    this._summaryStats.push({
      fileName: `${this._datasetName}.md`,
      title: 'My Posts',
      platform: 'Facebook',
      selfMessages: count,
      totalMessages: count,
      minDate,
      maxDate,
    });
  }

  public addEmailThread(input: MarkdownEmailInput): void {
    const filtered = filterMessagesBySelectedDays(input.messages, input.selectedDays, this._timeZone);
    if (filtered.length === 0) {
      return;
    }

    const participants = this._formatParticipants(input.participants, filtered);
    const lines: string[] = [
      `# Subject: ${input.subject || 'Untitled Email'}`,
      `- **Platform:** ${input.platform}`,
      `- **Participants:** ${participants.join(', ')}`,
    ];

    let selfCount = 0;
    let totalCount = 0;
    let minDate = '';
    let maxDate = '';

    for (const msg of filtered) {
      let body = msg.content ?? '';
      if (containsHtmlOrEntities(body)) {
        body = stripHtml(body);
      }
      body = stripQuotedHistory(body);
      body = stripCommonEmailBoilerplate(body);
      if (this._redactPII) {
        body = redactPII(body);
        body = redactTrackingNumbers(body);
      }
      body = body.trim();
      if (!body) {
        continue;
      }

      const dateKey = formatDateKey(msg.timestamp_ms, this._timeZone);
      const timeStr = formatTimeHHmm(msg.timestamp_ms, this._timeZone);
      const speaker = this._formatSpeaker(msg.sender_name);

      lines.push('', `**${dateKey} ${timeStr} | ${speaker}:**`, body);

      totalCount++;
      if (this._isMe(msg.sender_name)) {
        selfCount++;
      }
      if (!minDate || dateKey < minDate) {
        minDate = dateKey;
      }
      if (!maxDate || dateKey > maxDate) {
        maxDate = dateKey;
      }
    }

    if (totalCount === 0) {
      return;
    }

    this._emailSections.push({ subject: input.subject || 'Untitled Email', markdown: lines.join('\n') });
    this._summaryStats.push({
      fileName: `${this._datasetName}.md`,
      title: input.subject || 'Untitled Email',
      platform: input.platform,
      selfMessages: selfCount,
      totalMessages: totalCount,
      minDate,
      maxDate,
    });
  }

  public addEventRecord(content: string, timestampMs: number, platform: string, threadTitle?: string): void {
    this._eventBuilder.addLine(content, timestampMs, platform, threadTitle);
    const dateKey = formatDateKey(timestampMs, this._timeZone);
    this._eventCount++;
    if (!this._eventMinDate || dateKey < this._eventMinDate) {
      this._eventMinDate = dateKey;
    }
    if (!this._eventMaxDate || dateKey > this._eventMaxDate) {
      this._eventMaxDate = dateKey;
    }
  }

  public finalize(includeSummary = true): MarkdownFileOutput[] {
    const files: MarkdownFileOutput[] = [];

    const sections = [
      ...this._groupSections.map((s) => s.markdown),
      ...this._dmSections.map((s) => s.markdown),
      ...(this._postsMarkdown ? [`# Posts\n\n${this._postsMarkdown}`] : []),
      ...this._emailSections.map((s) => s.markdown),
    ];

    if (this._eventCount > 0) {
      const body = this._eventBuilder.finalize();
      if (body) {
        sections.push(`# Events\n\n${body}`);
        this._summaryStats.push({
          fileName: `${this._datasetName}.md`,
          title: 'Facebook Events',
          platform: 'Facebook',
          selfMessages: this._eventCount,
          totalMessages: this._eventCount,
          minDate: this._eventMinDate,
          maxDate: this._eventMaxDate,
        });
      }
    }

    if (sections.length > 0) {
      const frontmatter = buildYamlFrontmatter([
        ['type', 'message_samples'],
        ['self_label', this._selfLabel],
        ['timezone', this._timeZone],
      ]);
      files.push({
        fileName: `${this._datasetName}.md`,
        content: `${frontmatter}\n\n${sections.join('\n\n---\n\n')}\n`,
      });
    }

    if (includeSummary && files.length > 0) {
      files.push({
        fileName: `${this._datasetName}-summary.md`,
        content: this._buildSummaryMarkdown(files.map((f) => f.fileName)),
      });
    }

    return files;
  }

  private _buildSummaryMarkdown(generatedFileNames: string[]): string {
    const totalSelf = this._summaryStats.reduce((sum, s) => sum + s.selfMessages, 0);
    const totalAll = this._summaryStats.reduce((sum, s) => sum + s.totalMessages, 0);

    const lines: string[] = [
      `# Extraction Summary: ${this._datasetName}`,
      '',
      '> This summary is for your own verification; you do not need to upload it to ChatGPT.',
      '',
      `- **Self Label:** ${this._selfLabel}`,
      `- **Timezone:** ${this._timeZone}`,
      `- **Reference Files Generated:** ${generatedFileNames.length}`,
      `- **Total Messages Exported:** ${totalAll.toLocaleString()} (${totalSelf.toLocaleString()} by ${this._selfLabel})`,
      '',
      '## Files Generated',
      ...generatedFileNames.map((f) => `- \`${f}\``),
      '',
      '## Included Conversations & Sources',
      '',
      '| File | Source | Platform | Self Msgs | Total Msgs | Date Range |',
      '| :--- | :--- | :--- | ---: | ---: | :--- |',
      ...this._summaryStats.map(
        (s) =>
          `| \`${s.fileName}\` | ${s.title.replace(/\|/g, '\\|')} | ${s.platform} | ${s.selfMessages.toLocaleString()} | ${s.totalMessages.toLocaleString()} | ${s.minDate} to ${s.maxDate} |`,
      ),
      '',
    ];

    return lines.join('\n');
  }
}
