import { get_encoding } from 'tiktoken';
import { Message } from '@/lib/shared/types';
import { getDb } from './db';

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

export class DatasetGenerator {
  private db = getDb();
  private maxTokensPerFile: number;
  private includeGroupSpeakerNames: boolean;
  private mergeSequential: boolean;
  private removeSystemMessages: boolean;
  private imputeReactions: boolean;
  private redactPII: boolean;
  private personaTag?: string;
  private customInstructions?: string;
  private encoder = get_encoding('cl100k_base'); // GPT-4/3.5 standard

  constructor(options: DatasetOptions) {
    this.includeGroupSpeakerNames = options.includeGroupSpeakerNames;
    this.mergeSequential = options.mergeSequential || false;
    this.removeSystemMessages = options.removeSystemMessages || false;
    this.imputeReactions = options.imputeReactions || false;
    this.redactPII = options.redactPII || false;
    this.personaTag = options.personaTag;
    this.customInstructions = options.customInstructions;
    this.maxTokensPerFile = options.maxTokensPerFile || 1900000; // Safety buffer below 2M
  }

  public *generateStream(threadIds: string[], identityNames: string[], dateRange?: { start: number; end: number }): Generator<{ fileName: string; content: string; tokenCount: number }> {
    let batchedSessions: DatasetEntry[] = [];
    let batchedTokens = 0;
    let fileIndex = 1;

    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const maxTokensPerFile = this.maxTokensPerFile;
    const includeGroupSpeakerNames = this.includeGroupSpeakerNames;
    const mergeSequential = this.mergeSequential;
    const removeSystemMessages = this.removeSystemMessages;
    const imputeReactions = this.imputeReactions;
    const redactPII = this.redactPII;

    for (const threadId of threadIds) {
      const thread = this.db.prepare('SELECT is_group, platform, title FROM threads WHERE id = ?').get(threadId) as { is_group: number; platform: string; title: string } | undefined;

      if (!thread) {
        continue;
      }
      const isGroup = !!thread.is_group;

      let query = 'SELECT sender_name, content, timestamp_ms, media_json, reactions_json FROM messages WHERE thread_id = ?'; // Allow NULL/Empty content to check media
      const params: (string | number)[] = [threadId];

      if (dateRange) {
        query += ' AND timestamp_ms BETWEEN ? AND ?';
        params.push(dateRange.start, dateRange.end);
      }
      query += ' ORDER BY timestamp_ms ASC';

      const messages = this.db.prepare(query).all(...params) as Message[];
      if (!messages.length) {
        continue;
      }
      let currentSession: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
      const contextType = isGroup ? 'Group chat' : 'Chat';

      const platformMap: Record<string, string> = {
        google_voice: 'Google Voice',
        google_chat: 'Google Chat',
        facebook: 'Facebook',
        instagram: 'Instagram',
      };
      const displayPlatform = platformMap[thread.platform] || thread.platform;

      let systemContent = `Context: ${contextType} with "${thread.title || 'Unknown'}" on "${displayPlatform}".`;
      if (this.personaTag) {
        systemContent += ` [Persona: ${this.personaTag}]`;
      }
      if (this.customInstructions) {
        systemContent += ` ${this.customInstructions}`;
      }

      const systemMsg = { role: 'system' as const, content: systemContent };

      // Helper to finalize a session
      const finalizeSession = function* (this: DatasetGenerator, sessionRaw: typeof currentSession) {
        if (sessionRaw.length === 0) {
          return;
        }

        // Trim trailing messages that are not from assistant (Soft Block Rule)
        // We iterate backwards and remove user messages until we hit an assistant message.
        // This preserves the valid "User -> Assistant" turns in the session.
        let validEndIndex = sessionRaw.length - 1;
        while (validEndIndex >= 0 && sessionRaw[validEndIndex].role !== 'assistant') {
          validEndIndex--;
        }

        if (validEndIndex < 0) {
          return; // No assistant messages in this session at all
        }

        // Take the slice up to the last assistant message
        const finalSession = sessionRaw.slice(0, validEndIndex + 1);

        const sessionData: DatasetEntry = {
          messages: [systemMsg, ...finalSession],
        };

        // Precise Token Counting with Tiktoken
        // We sum the tokens of all message contents.
        // Approx: JSON overhead is small, but content is main driver.
        let tokens = 0;
        for (const m of sessionData.messages) {
          tokens += 4; // per-message overhead
          tokens += this.encoder.encode(m.content).length;
          tokens += this.encoder.encode(m.role).length;
        }
        tokens += 3; // Reply overhead

        // Check if adding this breaches limit
        if (batchedTokens + tokens > maxTokensPerFile) {
          // Yield current batch
          const content = batchedSessions.map((s) => JSON.stringify(s)).join('\n');
          yield { fileName: `virtual_me_part${fileIndex}.jsonl`, content, tokenCount: batchedTokens };
          fileIndex++;
          batchedSessions = [];
          batchedTokens = 0;
        }

        batchedSessions.push(sessionData);
        batchedTokens += tokens;
      }.bind(this); // Bind this for encoder access

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const prevMsg = i > 0 ? messages[i - 1] : null;

        if (prevMsg && msg.timestamp_ms - prevMsg.timestamp_ms > TWO_HOURS_MS) {
          yield* finalizeSession(currentSession);
          currentSession = [];
        }

        const isMe = identityNames.includes(msg.sender_name);

        let content = msg.content || '';

        // --- System Message Filter (NEW) ---
        if (removeSystemMessages && content) {
          const systemPatterns = [
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
          if (systemPatterns.some((regex) => regex.test(content))) {
            continue;
          }
        }

        // --- Content Cleaning Pipeline ---
        // 1. Skip Platform Artifacts
        if (content === 'MMS Sent') {
          continue;
        }

        // 2. Rewrite Attachments
        if (content === 'You sent an attachment.' || content.endsWith(' sent an attachment.')) {
          content = '[Sent an attachment]';
        }

        // 3. Handle Empty Content (Check for Media/Reactions)
        if (!content) {
          // Check if it really was empty or just media
          // We need to parse media_json if we want to be precise, but for now:
          if (msg.media_json && msg.media_json !== '[]') {
            content = '[Sent a photo/video]';
          } else if (msg.reactions_json && msg.reactions_json !== '[]') {
            // If it's a reaction-only update (common in some exports), we might skip or reword
            // But usually reactions are metadata on a message, not a standalone message.
            // If content is empty but has reaction, it might be a "reaction event".
            // Let's safe-skip empty content unless we are sure.
            continue;
          } else {
            continue;
          }
        }

        // URL Filter: Skip messages that are JUST a link
        const urlOnlyRegex = /^(https?:\/\/[^\s]+)\s*$/i;
        if (urlOnlyRegex.test(content)) {
          continue;
        }

        // PII Redaction
        if (redactPII) {
          const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
          const phoneRegex = /\b\+?1?\s*\(?-?\d{3}\)?\s*-?\d{3}\s*-?\d{4}\b/g;

          content = content.replace(emailRegex, '[REDACTED_EMAIL]');
          // Phone regex is tricky, might catch years or amounts. Use conservative matching if needed.
          // For now, strict formatting:
          content = content.replace(phoneRegex, '[REDACTED_PHONE]');
        }
        // Cleaning End ---

        const role = isMe ? 'assistant' : 'user';

        if (isGroup && !isMe && includeGroupSpeakerNames) {
          content = `[${msg.sender_name}]: ${content}`;
        }

        // Merge Sequential Logic
        let merged = false;
        if (mergeSequential && currentSession.length > 0) {
          const last = currentSession[currentSession.length - 1];
          if (last.role === role) {
            // Append to last message
            last.content += `\n${content}`;
            merged = true;
          }
        }

        if (!merged) {
          currentSession.push({ role, content });
        }

        // --- Impute Reactions as Replies (NEW) ---
        if (imputeReactions && msg.reactions_json) {
          try {
            const reactions = JSON.parse(msg.reactions_json) as { actor: string; reaction: string }[];
            if (Array.isArray(reactions)) {
              // Check if "Me" reacted
              const myReaction = reactions.find((r) => identityNames.includes(r.actor));
              if (myReaction) {
                // If I reacted to a USER message, it counts as a reply.
                // If I reacted to my own message, it's weird, but we can treat it as emphasis?
                // Usually we only care about reacting to OTHERS.
                // But if it IS me who sent the message, I probably shouldn't reply to myself with a reaction.

                if (!isMe) {
                  // Push a new Assistant message
                  // This ensures the session ends with Assistant (Active Block Rule satisfied!)
                  // We do NOT merge this, as it is a distinct action in time (technically).
                  const reactionContent = `[Reacted "${myReaction.reaction}"]`;
                  currentSession.push({ role: 'assistant', content: reactionContent });
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Final
      yield* finalizeSession(currentSession);
    }

    // Yield remainder
    if (batchedSessions.length > 0) {
      const content = batchedSessions.map((s) => JSON.stringify(s)).join('\n');
      yield { fileName: `virtual_me_part${fileIndex}.jsonl`, content, tokenCount: batchedTokens };
    }
  }
}
