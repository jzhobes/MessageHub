import Database from 'better-sqlite3';
import { encoding_for_model, Tiktoken, TiktokenModel } from 'tiktoken';

// Builders
import EmailPairBuilder, { Msg } from '@/lib/server/dataset/builders/EmailPairBuilder';
import { EventRecordBuilder } from '@/lib/server/dataset/builders/EventRecordBuilder';
import { MessageSessionBuilder } from '@/lib/server/dataset/builders/MessageSessionBuilder';
// Utilities & Shared
import { redactPII } from '@/lib/server/piiUtils';
import { inferThreadTitle } from '@/lib/server/threadUtils';
import { PlatformMap } from '@/lib/shared/platforms';
import { containsHtmlOrEntities, decodeHtmlEntities, stripHtml } from '@/lib/shared/stringUtils';
import { ContentRecord, DatasetEntry } from '@/lib/shared/types';

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
}

interface BatchState {
  fileIndex: number;
  sessions: DatasetEntry[];
  tokens: number;
}

export class DatasetGenerator {
  private _dbInstance: Database.Database | null = null;
  private _encoder: Tiktoken;
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

  constructor(opts: GeneratorOptions) {
    // Database instance is provided after instantiation via setDb()
    this._encoder = encoding_for_model('gpt-4' as TiktokenModel);
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
  }

  public setDb(db: Database.Database) {
    this._dbInstance = db;
  }

  public async *generateStream(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<{ fileName: string; content: string; tokenCount: number }> {
    const batchState: BatchState = { fileIndex: 1, sessions: [], tokens: 0 };
    const myNamesLower = new Set(identityNames.map((n) => n.toLowerCase().trim()));
    const myNamesList = Array.from(myNamesLower);

    const historyBuilder = this._skipSystemMessages ? new EventRecordBuilder({ identityName: identityNames[0] }) : null;

    if (!this._dbInstance) {
      throw new Error('Database instance not set in DatasetGenerator');
    }

    for (let threadIdx = 0; threadIdx < threadIds.length; threadIdx++) {
      const threadId = threadIds[threadIdx];
      if (onProgress) {
        onProgress(threadIdx, threadIds.length);
      }

      // Yield to event loop AFTER EVERY THREAD to keep server responsive
      await new Promise((resolve) => setImmediate(resolve));

      let query = '';
      const params: (string | number)[] = [];
      let isGroup = false;
      let platform = 'facebook';
      let title = '';
      let contextType = 'Chat';

      if (threadId === 'fb-post-all') {
        title = 'My Posts';
        contextType = 'Wall Posts';
        query = `
          SELECT t.title as thread_title, m.sender_name, m.content, m.timestamp_ms, m.media_json, m.reactions_json 
          FROM content m
          JOIN threads t ON m.thread_id = t.id
          JOIN thread_labels tl ON m.thread_id = tl.thread_id
          WHERE tl.label = 'post'
        `;
      } else if (threadId.startsWith('fb-event-')) {
        const cat = threadId.replace('fb-event-', '');
        const statuses = cat === 'owned' ? ['Created Event'] : ['Joined Event', 'Interested in Event'];
        title = cat === 'owned' ? 'Your Events' : 'Joined Events';
        contextType = 'Event Activity';

        const placeholders = statuses.map(() => '?').join(',');
        query = `
          SELECT t.title as thread_title, m.sender_name, m.content, m.timestamp_ms, m.media_json, m.reactions_json 
          FROM content m
          JOIN threads t ON m.thread_id = t.id
          JOIN thread_labels tl ON m.thread_id = tl.thread_id
          WHERE tl.label = 'event' AND m.content IN (${placeholders})
        `;
        params.push(...statuses);
      } else {
        const thread = this._dbInstance
          .prepare('SELECT is_group, platform, title, participants_json FROM threads WHERE id = ?')
          .get(threadId) as
          | { is_group: number; platform: string; title: string; participants_json: string }
          | undefined;

        if (!thread) {
          continue;
        }

        isGroup = !!thread.is_group;
        platform = thread.platform;
        contextType = isGroup ? 'Group chat' : 'Chat';

        const participants = JSON.parse(thread.participants_json || '[]');
        title = inferThreadTitle(thread.title, participants, identityNames);

        query =
          'SELECT sender_name, content, timestamp_ms, media_json, reactions_json FROM content WHERE thread_id = ?';
        params.push(threadId);
      }

      if (dateRange) {
        query += ' AND timestamp_ms BETWEEN ? AND ?';
        params.push(dateRange.start, dateRange.end);
      }
      query += ' ORDER BY timestamp_ms ASC';

      const messages = this._dbInstance.prepare(query).all(...params) as ContentRecord[];
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
              tokenizer: (p) => this._encoder.encode(p).length,
              threadTitle: isVirtual ? undefined : title,
              isGroup,
              platform: isPost ? 'Facebook Post' : isEvent ? 'Facebook Event' : platform,
            })
          : null;

      for (let i = 0; i < messages.length; i++) {
        if (i > 0 && i % 500 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        const msg = messages[i];
        const prevMsg = i > 0 ? messages[i - 1] : null;

        if (!isVirtual && prevMsg && msg.timestamp_ms - prevMsg.timestamp_ms > sessionTimeout) {
          if (chatBuilder) {
            const session = chatBuilder.finalize();
            if (session) {
              yield* this._emitSession(session, batchState);
            }
          }
        } else if (isVirtual && prevMsg) {
          if (chatBuilder) {
            const session = chatBuilder.finalize();
            if (session) {
              yield* this._emitSession(session, batchState);
            }
          }
        }

        const normalizedSender = msg.sender_name?.toLowerCase().trim() || '';
        let isMe = normalizedSender && myNamesLower.has(normalizedSender);
        if (!isMe && normalizedSender) {
          isMe = myNamesList.some((name) => normalizedSender.includes(name) || name.includes(normalizedSender));
        }

        const cleanedContent = this._cleanContent(msg, platform, { isPost });
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
          historyBuilder.addLine(cleanedContent, msg.timestamp_ms, platform, msg.thread_title);
          continue;
        }

        // Gmail path
        if (platform === 'google_mail') {
          if (role === 'user') {
            emailBuilder!.addInbound(content, msg.sender_name);
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
              yield* this._emitSession(session, batchState);
            }
          }
          continue;
        }

        // Chat path
        if (chatBuilder) {
          const session = chatBuilder.addMessage(content, role, msg.sender_name, msg.timestamp_ms, msg.reactions_json);
          if (session) {
            yield* this._emitSession(session, batchState);
          }
        }
      }

      if (chatBuilder) {
        const session = chatBuilder.finalize();
        if (session) {
          yield* this._emitSession(session, batchState);
        }
      }
    }

    // Yield Remainder JSONL
    if (batchState.sessions.length > 0) {
      const content = batchState.sessions.map((s) => JSON.stringify(s)).join('\n');
      const suffix = batchState.fileIndex === 1 ? '' : `.part${batchState.fileIndex}`;
      yield { fileName: `${this._datasetName}${suffix}.jsonl`, content, tokenCount: batchState.tokens };
    }

    // Yield Final Markdown History (Events)
    if (historyBuilder) {
      const mdContent = historyBuilder.finalize();
      if (mdContent) {
        yield {
          fileName: `${this._datasetName}-history.md`,
          content: mdContent,
          tokenCount: this._encoder.encode(mdContent).length,
        };
      }
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
      content = decodeHtmlEntities(stripHtml(content));
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
        tokens += 4 + this._encoder.encode(m.content).length + this._encoder.encode(m.role).length;
      }
    } else {
      tokens = this._encoder.encode(json).length;
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
