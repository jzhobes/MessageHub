import EmailPairBuilder, { Msg } from '@/lib/shared/dataset/builders/EmailPairBuilder';
import { EventRecordBuilder } from '@/lib/shared/dataset/builders/EventRecordBuilder';
import { MarkdownExportBuilder, MarkdownMessageRow } from '@/lib/shared/dataset/builders/MarkdownExportBuilder';
import { MessageSessionBuilder } from '@/lib/shared/dataset/builders/MessageSessionBuilder';
import { ThreadDaySampleResult } from '@/lib/shared/dataset/sampleThreadDays';
import { redactPII } from '@/lib/shared/piiUtils';
import { PlatformMap } from '@/lib/shared/platforms';
import { containsHtmlOrEntities, stripHtml } from '@/lib/shared/stringUtils';
import { inferThreadTitle } from '@/lib/shared/threadUtils';
import { ContentRecord, DatasetEntry } from '@/lib/shared/types';

export interface DatasetThreadMeta {
  is_group: number;
  platform: string;
  title: string | null;
  participants_json: string | null;
}

export interface DatasetRow {
  sender_name: string | null;
  content: string | null;
  timestamp_ms: number;
  media_json?: string | null;
  reactions_json?: string | null;
  share_json?: string | null;
  annotations_json?: string | null;
  thread_title?: string | null;
}

export interface DatasetDataSource {
  getThread(threadId: string): DatasetThreadMeta | undefined;
  getThreadMessages(threadId: string, dateRange?: { start: number; end: number }): DatasetRow[];
  getPostMessages(dateRange?: { start: number; end: number }): DatasetRow[];
  getEventMessages(statuses: string[], dateRange?: { start: number; end: number }): DatasetRow[];
  sampleThreadDays(
    threadId: string,
    identityNames: string[],
    opts: { dateRange?: { start: number; end: number }; timeZone?: string; targetMessages?: number },
  ): ThreadDaySampleResult;
}

export interface GeneratorOptions {
  includeGroupSpeakerNames: boolean;
  mergeSequential: boolean;
  removeSystemMessages: boolean;
  imputeReactions: boolean;
  redactPII: boolean;
  maxTokensPerSession: number;
  maxTokensPerFile: number;
  personaTag?: string;
  customInstructions?: string;
  skipSystemMessages: boolean;
  datasetName?: string;
  outputFormat?: 'jsonl' | 'markdown';
  selectedDaysByThread?: Record<string, string[]>;
  timeZone?: string;
  includeSummary?: boolean;
}

export type GeneratedRecord =
  { kind: 'session'; entry: DatasetEntry } | { kind: 'markdown'; fileName: string; content: string };

interface BatchState {
  fileIndex: number;
  sessions: DatasetEntry[];
  tokens: number;
}

function defaultTokenCount(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

export class DatasetCore {
  private _dataSource: DatasetDataSource | null = null;
  private _countTokens: (text: string) => number;
  private _includeGroupSpeakerNames: boolean;
  private _mergeSequential: boolean;
  private _removeSystemMessages: boolean;
  private _imputeReactions: boolean;
  private _redactPII: boolean;
  private _maxTokensPerSession: number;
  private _maxTokensPerFile: number;
  private _personaTag?: string;
  private _customInstructions?: string;
  private _skipSystemMessages: boolean;
  private _datasetName: string;
  private _outputFormat: 'jsonl' | 'markdown';
  private _selectedDaysByThread?: Record<string, string[]>;
  private _timeZone?: string;
  private _includeSummary: boolean;

  constructor(opts: GeneratorOptions & { countTokens?: (text: string) => number }) {
    this._countTokens = opts.countTokens ?? defaultTokenCount;
    this._includeGroupSpeakerNames = opts.includeGroupSpeakerNames;
    this._mergeSequential = opts.mergeSequential;
    this._removeSystemMessages = opts.removeSystemMessages;
    this._imputeReactions = opts.imputeReactions;
    this._redactPII = opts.redactPII;
    this._maxTokensPerSession = opts.maxTokensPerSession;
    this._maxTokensPerFile = opts.maxTokensPerFile;
    this._personaTag = opts.personaTag;
    this._customInstructions = opts.customInstructions;
    this._skipSystemMessages = opts.skipSystemMessages;
    this._datasetName = opts.datasetName || 'dataset';
    this._outputFormat = opts.outputFormat || 'jsonl';
    this._selectedDaysByThread = opts.selectedDaysByThread;
    this._timeZone = opts.timeZone;
    this._includeSummary = opts.includeSummary ?? true;
  }

  public setDataSource(source: DatasetDataSource) {
    this._dataSource = source;
  }

  /**
   * Streams structured dataset records (training sessions and optional Markdown history)
   * without coupling consumers to SQLite or file packaging. Requires `setDataSource()` first.
   */
  public async *generateRecords(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<GeneratedRecord> {
    if (!this._dataSource) {
      throw new Error('Data source not set in DatasetCore');
    }

    if (this._outputFormat === 'markdown') {
      yield* this._generateMarkdownRecords(threadIds, identityNames, dateRange, onProgress);
      return;
    }

    const myNamesLower = new Set(identityNames.map((n) => n.toLowerCase().trim()));
    const myNamesList = Array.from(myNamesLower);

    const historyBuilder = this._skipSystemMessages ? new EventRecordBuilder({ identityName: identityNames[0] }) : null;

    for (let threadIdx = 0; threadIdx < threadIds.length; threadIdx++) {
      const threadId = threadIds[threadIdx];
      if (onProgress) {
        onProgress(threadIdx, threadIds.length);
      }

      // Yield to event loop AFTER EVERY THREAD to keep runtime responsive
      await new Promise((resolve) => setTimeout(resolve, 0));

      let isGroup = false;
      let platform = 'facebook';
      let title = '';
      let contextType = 'Chat';
      let messages: DatasetRow[] = [];

      if (threadId === 'fb-post-all') {
        title = 'My Posts';
        contextType = 'Wall Posts';
        messages = this._dataSource.getPostMessages(dateRange);
      } else if (threadId.startsWith('fb-event-')) {
        const cat = threadId.replace('fb-event-', '');
        const statuses = cat === 'owned' ? ['Created Event'] : ['Joined Event', 'Interested in Event'];
        title = cat === 'owned' ? 'Your Events' : 'Joined Events';
        contextType = 'Event Activity';
        messages = this._dataSource.getEventMessages(statuses, dateRange);
      } else {
        const thread = this._dataSource.getThread(threadId);
        if (!thread) {
          continue;
        }

        isGroup = !!thread.is_group;
        platform = thread.platform;
        contextType = isGroup ? 'Group chat' : 'Chat';

        const participants = JSON.parse(thread.participants_json || '[]');
        title = inferThreadTitle(thread.title, participants, identityNames);
        messages = this._dataSource.getThreadMessages(threadId, dateRange);
      }

      if (!messages.length) {
        continue;
      }

      const displayPlatform = PlatformMap[platform] || platform;
      const isVirtual = threadId === 'fb-post-all' || threadId.startsWith('fb-event-');
      const isPost = threadId === 'fb-post-all';
      const isEvent = threadId.startsWith('fb-event-');

      const sessionTimeout = platform === 'google_mail' ? 7 * 24 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000;
      const systemContent = this._buildSystemMessage(identityNames, title, contextType, displayPlatform);
      const systemMsg = { role: 'system' as const, content: systemContent };

      const emailBuilder =
        platform === 'google_mail'
          ? new EmailPairBuilder({
              userName: identityNames[0],
              injectSubjectOnce: true,
              subject: title && title !== 'Unknown' ? title : undefined,
              dropOutboundOnly: true,
              includeSenderNamePrefix: true,
              redactPII: this._redactPII,
              redactTrackingNumbers: true,
            })
          : null;

      const chatBuilder =
        platform !== 'google_mail'
          ? new MessageSessionBuilder({
              maxTokensPerSession: this._maxTokensPerSession,
              mergeSequential: this._mergeSequential,
              includeGroupSpeakerNames: this._includeGroupSpeakerNames,
              imputeReactions: this._imputeReactions,
              identityNames,
              systemMsg,
              skipSystemMessages: this._skipSystemMessages,
              tokenizer: (p) => this._countTokens(p),
              threadTitle: isVirtual ? undefined : title,
              isGroup,
              platform: isPost ? 'Facebook Post' : isEvent ? 'Facebook Event' : platform,
            })
          : null;

      for (let i = 0; i < messages.length; i++) {
        if (i > 0 && i % 500 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const msg = messages[i];
        const prevMsg = i > 0 ? messages[i - 1] : null;

        if (!isVirtual && prevMsg && msg.timestamp_ms - prevMsg.timestamp_ms > sessionTimeout) {
          if (chatBuilder) {
            const session = chatBuilder.finalize();
            if (session) {
              yield { kind: 'session', entry: session };
            }
          }
        } else if (isVirtual && prevMsg) {
          if (chatBuilder) {
            const session = chatBuilder.finalize();
            if (session) {
              yield { kind: 'session', entry: session };
            }
          }
        }

        const senderName = msg.sender_name || '';
        const normalizedSender = senderName.toLowerCase().trim();
        let isMe = !!(normalizedSender && myNamesLower.has(normalizedSender));
        if (!isMe && normalizedSender) {
          isMe = myNamesList.some((name) => normalizedSender.includes(name) || name.includes(normalizedSender));
        }

        const asContentRecord: ContentRecord = {
          id: `${msg.timestamp_ms}_${i}`,
          is_sender: isMe,
          sender_name: senderName,
          timestamp_ms: msg.timestamp_ms,
          content: msg.content ?? undefined,
          media_json: msg.media_json ?? undefined,
          reactions_json: msg.reactions_json ?? undefined,
          thread_title: msg.thread_title ?? undefined,
        };

        const cleanedContent = this._cleanContent(asContentRecord, platform, { isPost });
        if (!cleanedContent || (this._removeSystemMessages && this._isSystemMessage(cleanedContent))) {
          continue;
        }

        let role: 'user' | 'assistant' = isMe ? 'assistant' : 'user';
        if (!isMe && isVirtual) {
          role = 'assistant';
        }

        let content: string = cleanedContent;
        if (isVirtual) {
          const dateStr = new Date(msg.timestamp_ms).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          if (msg.thread_title) {
            if (threadId.startsWith('fb-event-')) {
              content = `${content}: ${msg.thread_title}${this._skipSystemMessages ? '' : ` (${dateStr})`}`;
            } else if (content === 'Post' || !content) {
              content = `${msg.thread_title}${this._skipSystemMessages ? '' : ` (${dateStr})`}`;
            } else {
              content = `${content}${this._skipSystemMessages ? '' : ` (${dateStr})`}`;
            }
          } else {
            content = `${content}${this._skipSystemMessages ? '' : ` (${dateStr})`}`;
          }

          if (!isEvent && chatBuilder && !this._skipSystemMessages) {
            const userPrompt =
              threadId === 'fb-post-all' ? 'Share a post from your wall.' : 'Update us on your event activity.';
            chatBuilder.addMessage(userPrompt, 'user', 'User', msg.timestamp_ms);
          }
        }

        // KNOWLEDGE MODE: Events go to history.md
        if (isEvent && historyBuilder) {
          historyBuilder.addLine(cleanedContent, msg.timestamp_ms, platform, msg.thread_title ?? undefined);
          continue;
        }

        // Gmail path
        if (platform === 'google_mail') {
          if (role === 'user') {
            emailBuilder!.addInbound(content, senderName);
          } else {
            const pair = emailBuilder!.addOutbound(content);
            if (pair) {
              let session: DatasetEntry;
              if (this._skipSystemMessages) {
                const dateHeader = new Date(msg.timestamp_ms).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const header = `[Gmail · ${dateHeader}]`;
                const combined = pair
                  .map((m: Msg) => (m.role === 'assistant' ? m.content : `[Sender]: ${m.content}`))
                  .join('\n');
                session = { messages: [{ role: 'assistant', content: `${header}\n${combined}` }] };
              } else {
                session = { messages: [systemMsg, ...pair] };
              }
              yield { kind: 'session', entry: session };
            }
          }
          continue;
        }

        // Chat path
        if (chatBuilder) {
          const session = chatBuilder.addMessage(
            content,
            role,
            senderName,
            msg.timestamp_ms,
            msg.reactions_json ?? undefined,
          );
          if (session) {
            yield { kind: 'session', entry: session };
          }
        }
      }

      if (chatBuilder) {
        const session = chatBuilder.finalize();
        if (session) {
          yield { kind: 'session', entry: session };
        }
      }
    }

    // Yield Final Markdown History (Events)
    if (historyBuilder) {
      const mdContent = historyBuilder.finalize();
      if (mdContent) {
        yield {
          kind: 'markdown',
          fileName: `${this._datasetName}-history.md`,
          content: mdContent,
        };
      }
    }
  }

  private async *_generateMarkdownRecords(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<GeneratedRecord> {
    const dataSource = this._dataSource!;
    const mdBuilder = new MarkdownExportBuilder({
      datasetName: this._datasetName,
      identityNames,
      includeReactions: this._imputeReactions,
      removeSystemMessages: this._removeSystemMessages,
      redactPII: this._redactPII,
      timeZone: this._timeZone,
    });

    for (let threadIdx = 0; threadIdx < threadIds.length; threadIdx++) {
      const threadId = threadIds[threadIdx];
      if (onProgress) {
        onProgress(threadIdx, threadIds.length);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      const explicitDays = this._selectedDaysByThread?.[threadId];
      // Only bound by dateRange when using auto-scan; explicit user-picked days may be older than recencyFilter
      const effectiveDateRange = dateRange && (!explicitDays || explicitDays.length === 0) ? dateRange : undefined;

      if (threadId === 'fb-post-all') {
        const rows = dataSource.getPostMessages(effectiveDateRange) as MarkdownMessageRow[];
        const selectedDays =
          explicitDays && explicitDays.length > 0
            ? explicitDays
            : dataSource.sampleThreadDays(threadId, identityNames, {
                dateRange,
                timeZone: this._timeZone,
              }).selectedDays;
        mdBuilder.addPosts({ messages: rows, selectedDays });
        continue;
      }

      if (threadId.startsWith('fb-event-')) {
        const cat = threadId.replace('fb-event-', '');
        const statuses = cat === 'owned' ? ['Created Event'] : ['Joined Event', 'Interested in Event'];
        const rows = dataSource.getEventMessages(statuses, dateRange);
        for (const r of rows) {
          if (r.content) {
            mdBuilder.addEventRecord(r.content, r.timestamp_ms, 'facebook', r.thread_title ?? undefined);
          }
        }
        continue;
      }

      const thread = dataSource.getThread(threadId);
      if (!thread) {
        continue;
      }

      const participants: string[] = JSON.parse(thread.participants_json || '[]');
      const title = inferThreadTitle(thread.title, participants, identityNames);
      const displayPlatform = PlatformMap[thread.platform] || thread.platform;
      const isEmail = thread.platform === 'google_mail' || thread.platform === 'gmail';

      const rows = dataSource.getThreadMessages(threadId, effectiveDateRange) as MarkdownMessageRow[];
      if (rows.length === 0) {
        continue;
      }

      const selectedDays =
        explicitDays && explicitDays.length > 0
          ? explicitDays
          : dataSource.sampleThreadDays(threadId, identityNames, {
              dateRange,
              timeZone: this._timeZone,
            }).selectedDays;

      if (isEmail) {
        mdBuilder.addEmailThread({
          threadId,
          subject: title,
          platform: displayPlatform,
          participants,
          messages: rows,
          selectedDays,
        });
      } else {
        mdBuilder.addChatThread({
          threadId,
          title,
          platform: displayPlatform,
          isGroup: !!thread.is_group,
          participants,
          messages: rows,
          selectedDays,
        });
      }
    }

    const files = mdBuilder.finalize(this._includeSummary);
    for (const f of files) {
      yield {
        kind: 'markdown',
        fileName: f.fileName,
        content: f.content,
      };
    }
  }

  /**
   * Streams formatted dataset files for the selected thread IDs.
   * Requires `setDataSource()` to be called first.
   */
  public async *generateStream(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<{ fileName: string; content: string; tokenCount: number }> {
    const batchState: BatchState = { fileIndex: 1, sessions: [], tokens: 0 };
    const markdownRecords: Extract<GeneratedRecord, { kind: 'markdown' }>[] = [];

    for await (const record of this.generateRecords(threadIds, identityNames, dateRange, onProgress)) {
      if (record.kind === 'session') {
        yield* this._emitSession(record.entry, batchState);
      } else {
        markdownRecords.push(record);
      }
    }

    // Yield Remainder JSONL
    if (batchState.sessions.length > 0) {
      const content = batchState.sessions.map((s) => JSON.stringify(s)).join('\n');
      const suffix = batchState.fileIndex === 1 ? '' : `.part${batchState.fileIndex}`;
      yield { fileName: `${this._datasetName}${suffix}.jsonl`, content, tokenCount: batchState.tokens };
    }

    // Yield All Markdown Records
    for (const md of markdownRecords) {
      yield {
        fileName: md.fileName,
        content: md.content,
        tokenCount: this._countTokens(md.content),
      };
    }
  }

  private _buildSystemMessage(identityNames: string[], title: string, contextType: string, platform: string): string {
    const names = identityNames.join(', ');
    let base = `You are ${names}. This is a ${contextType} from ${platform}`;
    if (title && title !== 'Unknown') {
      base += ` titled "${title}"`;
    }
    base += ". Speak naturally in the user's style.";
    if (this._personaTag) {
      base += ` Context: ${this._personaTag}`;
    }
    if (this._customInstructions) {
      base += ` Instructions: ${this._customInstructions}`;
    }
    return base;
  }

  private _isSystemMessage(content: string): boolean {
    const patterns = [
      /^.* named the group .*$/i,
      /^.* changed the group photo\.$/i,
      /^.* added .* to the group\.$/i,
      /^.* left the group\.$/i,
      /^.* started a video call\.$/i,
      /^.* started an audio call\.$/i,
      /^.* changed the theme to .*$/i,
      /^You missed a call from .*$/i,
      /^You called .*$/i,
      /^.* shared a link\.$/i,
      /^.* updated (his|her|their) status\.$/i,
      /^.* is interested in an event: .*$/i,
      /^.* joined the event: .*$/i,
      /^.* created the event: .*$/i,
    ];
    return patterns.some((regex) => regex.test(content));
  }

  private _cleanContent(msg: ContentRecord, platform?: string, opts: { isPost?: boolean } = {}): string | null {
    let content = msg.content || '';
    if (content === 'MMS Sent') {
      return null;
    }
    if (content === 'You sent an attachment.' || content.endsWith(' sent an attachment.')) {
      if (opts.isPost || this._skipSystemMessages) {
        return null;
      }
      content = '[Sent an attachment]';
    }
    if (containsHtmlOrEntities(content)) {
      content = stripHtml(content);
    }
    if (!content) {
      if (msg.media_json && msg.media_json !== '[]') {
        if (opts.isPost || this._skipSystemMessages) {
          return null;
        }
        content = '[Sent a photo/video]';
      } else {
        return null;
      }
    }
    const urlOnlyRegex = /^(https?:\/\/[^\s]+)\s*$/i;
    if (urlOnlyRegex.test(content) && platform !== 'google_mail') {
      return null;
    }

    const lowSignalLabels = ['Joined Event', 'Interested in Event', 'Created Event'];
    const isEventLabel = lowSignalLabels.includes(content.trim());
    if ((content.trim() === 'Post' || isEventLabel) && (!msg.media_json || msg.media_json === '[]')) {
      if (this._skipSystemMessages && isEventLabel) {
      } else {
        return null;
      }
    }

    if (platform !== 'google_mail' && content.trim().length < 2) {
      return null;
    }
    if (opts.isPost) {
      const birthdayHeuristic = /^(happy birthday|hbd|happy bday|feliz cumple)/i;
      if (birthdayHeuristic.test(content.trim()) && content.trim().length < 20) {
        return null;
      }
    }
    if (this._redactPII) {
      content = redactPII(content);
    }
    return content;
  }

  private *_emitSession(
    session: DatasetEntry,
    state: BatchState,
  ): Generator<{ fileName: string; content: string; tokenCount: number }> {
    yield* this._emitRawRecord(session, state);
  }

  private *_emitRawRecord(
    record: DatasetEntry,
    state: BatchState,
  ): Generator<{ fileName: string; content: string; tokenCount: number }> {
    const json = JSON.stringify(record);
    let tokens = 0;
    if (record.messages) {
      tokens = 3;
      for (const m of record.messages) {
        tokens += 4 + this._countTokens(m.content) + this._countTokens(m.role);
      }
    } else {
      tokens = this._countTokens(json);
    }

    if (state.tokens + tokens > this._maxTokensPerFile) {
      const content = state.sessions.map((s) => JSON.stringify(s)).join('\n');
      yield { fileName: `${this._datasetName}.part${state.fileIndex}.jsonl`, content, tokenCount: state.tokens };
      state.fileIndex++;
      state.sessions = [];
      state.tokens = 0;
    }
    state.sessions.push(record);
    state.tokens += tokens;
  }
}
