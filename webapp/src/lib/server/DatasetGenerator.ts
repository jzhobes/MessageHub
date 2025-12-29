import { get_encoding } from 'tiktoken';

import { PlatformMap } from '@/lib/shared/platforms';
import { ContentRecord } from '@/lib/shared/types';

import db from './db';

export interface DatasetEntry {
  messages: {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }[];
}

export interface DatasetOptions {
  includeGroupSpeakerNames: boolean;
  mergeSequential?: boolean;
  removeSystemMessages?: boolean;
  imputeReactions?: boolean;
  redactPII?: boolean;
  personaTag?: string; // e.g. "Professional"
  customInstructions?: string; // e.g. "Do not use emojis"
  maxTokensPerFile?: number; // Default 1.9M
}

export interface DatasetCheckResult {
  fileCount: number;
  totalTokens: number;
  totalSessions: number;
}

interface BatchState {
  sessions: DatasetEntry[];
  tokens: number;
  fileIndex: number;
}

export class DatasetGenerator {
  private _dbInstance = db.get();
  private _maxTokensPerFile: number;
  private _includeGroupSpeakerNames: boolean;
  private _mergeSequential: boolean;
  private _removeSystemMessages: boolean;
  private _imputeReactions: boolean;
  private _redactPII: boolean;
  private _personaTag?: string;
  private _customInstructions?: string;
  private _encoder = get_encoding('cl100k_base'); // GPT-4/3.5 standard

  constructor(options: DatasetOptions) {
    this._includeGroupSpeakerNames = options.includeGroupSpeakerNames;
    this._mergeSequential = options.mergeSequential ?? false;
    this._removeSystemMessages = options.removeSystemMessages ?? false;
    this._imputeReactions = options.imputeReactions ?? false;
    this._redactPII = options.redactPII ?? false;
    this._personaTag = options.personaTag;
    this._customInstructions = options.customInstructions;
    this._maxTokensPerFile = options.maxTokensPerFile ?? 1900000; // Safety buffer below 2M
  }

  public async *generateStream(
    threadIds: string[],
    identityNames: string[],
    dateRange?: { start: number; end: number },
    onProgress?: (current: number, total: number) => void,
  ): AsyncGenerator<{ fileName: string; content: string; tokenCount: number }> {
    const batchState: BatchState = {
      sessions: [],
      tokens: 0,
      fileIndex: 1,
    };

    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    let processedCount = 0;

    for (const threadId of threadIds) {
      processedCount++;
      if (onProgress) {
        onProgress(processedCount, threadIds.length);
      }

      // Yield to event loop AFTER EVERY THREAD to keep server responsive
      await new Promise((resolve) => setImmediate(resolve));

      const thread = this._dbInstance
        .prepare('SELECT is_group, platform, title FROM threads WHERE id = ?')
        .get(threadId) as { is_group: number; platform: string; title: string } | undefined;

      if (!thread) {
        continue;
      }
      const isGroup = !!thread.is_group;

      let query =
        'SELECT sender_name, content, timestamp_ms, media_json, reactions_json FROM content WHERE thread_id = ?';
      const params: (string | number)[] = [threadId];

      if (dateRange) {
        query += ' AND timestamp_ms BETWEEN ? AND ?';
        params.push(dateRange.start, dateRange.end);
      }
      query += ' ORDER BY timestamp_ms ASC';

      const messages = this._dbInstance.prepare(query).all(...params) as ContentRecord[];
      if (!messages.length) {
        continue;
      }

      let currentSession: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
      const contextType = isGroup ? 'Group chat' : 'Chat';

      const displayPlatform = PlatformMap[thread.platform] || thread.platform;

      let systemContent = `Context: ${contextType} with "${thread.title || 'Unknown'}" on "${displayPlatform}".`;
      if (this._personaTag) {
        systemContent += ` [Persona: ${this._personaTag}]`;
      }
      if (this._customInstructions) {
        systemContent += ` ${this._customInstructions}`;
      }

      const systemMsg = { role: 'system' as const, content: systemContent };

      for (let i = 0; i < messages.length; i++) {
        // Yield inside massive threads (every 500 msgs)
        if (i > 0 && i % 500 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }

        const msg = messages[i];
        const prevMsg = i > 0 ? messages[i - 1] : null;

        if (prevMsg && msg.timestamp_ms - prevMsg.timestamp_ms > TWO_HOURS_MS) {
          yield* this._finalizeSession(currentSession, systemMsg, batchState);
          currentSession = [];
        }

        const isMe = identityNames.includes(msg.sender_name);
        const cleanedContent = this._cleanContent(msg);

        if (!cleanedContent || (this._removeSystemMessages && this._isSystemMessage(cleanedContent))) {
          continue;
        }

        const role = isMe ? 'assistant' : 'user';
        let content = cleanedContent;

        if (isGroup && !isMe && this._includeGroupSpeakerNames) {
          content = `[${msg.sender_name}]: ${content}`;
        }

        // Merge Sequential Logic
        let merged = false;
        if (this._mergeSequential && currentSession.length > 0) {
          const last = currentSession[currentSession.length - 1];
          if (last.role === role) {
            last.content += `\n${content}`;
            merged = true;
          }
        }

        if (!merged) {
          currentSession.push({ role, content });
        }

        // Impute Reactions
        if (this._imputeReactions && msg.reactions_json) {
          const reactionReply = this._getReactionReply(msg.reactions_json, identityNames);
          if (reactionReply && !isMe) {
            currentSession.push({ role: 'assistant', content: reactionReply });
          }
        }
      }

      yield* this._finalizeSession(currentSession, systemMsg, batchState);
    }

    // Yield remainder
    if (batchState.sessions.length > 0) {
      const content = batchState.sessions.map((s) => JSON.stringify(s)).join('\n');
      yield { fileName: `virtual_me_part${batchState.fileIndex}.jsonl`, content, tokenCount: batchState.tokens };
    }
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
    ];
    return patterns.some((regex) => regex.test(content));
  }

  private _cleanContent(msg: ContentRecord): string | null {
    let content = msg.content || '';

    if (content === 'MMS Sent') {
      return null;
    }
    if (content === 'You sent an attachment.' || content.endsWith(' sent an attachment.')) {
      content = '[Sent an attachment]';
    }

    if (!content) {
      if (msg.media_json && msg.media_json !== '[]') {
        content = '[Sent a photo/video]';
      } else {
        return null;
      }
    }

    const urlOnlyRegex = /^(https?:\/\/[^\s]+)\s*$/i;
    if (urlOnlyRegex.test(content)) {
      return null;
    }

    if (this._redactPII) {
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const phoneRegex = /\b\+?1?\s*\(?-?\d{3}\)?\s*-?\d{3}\s*-?\d{4}\b/g;
      content = content.replace(emailRegex, '[REDACTED_EMAIL]').replace(phoneRegex, '[REDACTED_PHONE]');
    }

    return content;
  }

  private _getReactionReply(reactionsJson: string, identityNames: string[]): string | null {
    try {
      const reactions = JSON.parse(reactionsJson);
      if (Array.isArray(reactions)) {
        const myReaction = reactions.find((r) => identityNames.includes(r.actor));
        if (myReaction) {
          return `[Reacted "${myReaction.reaction}"]`;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  private *_finalizeSession(
    sessionRaw: { role: 'system' | 'user' | 'assistant'; content: string }[],
    systemMsg: { role: 'system'; content: string },
    state: BatchState,
  ) {
    if (sessionRaw.length === 0) {
      return;
    }

    let validEndIndex = sessionRaw.length - 1;
    while (validEndIndex >= 0 && sessionRaw[validEndIndex].role !== 'assistant') {
      validEndIndex--;
    }

    if (validEndIndex < 0) {
      return;
    }

    const finalSession = sessionRaw.slice(0, validEndIndex + 1);
    const sessionData: DatasetEntry = {
      messages: [systemMsg, ...finalSession],
    };

    let tokens = 3; // Reply overhead
    for (const m of sessionData.messages) {
      tokens += 4; // per-message overhead
      tokens += this._encoder.encode(m.content).length;
      tokens += this._encoder.encode(m.role).length;
    }

    if (state.tokens + tokens > this._maxTokensPerFile) {
      const content = state.sessions.map((s) => JSON.stringify(s)).join('\n');
      yield { fileName: `virtual_me_part${state.fileIndex}.jsonl`, content, tokenCount: state.tokens };
      state.fileIndex++;
      state.sessions = [];
      state.tokens = 0;
    }

    state.sessions.push(sessionData);
    state.tokens += tokens;
  }
}
