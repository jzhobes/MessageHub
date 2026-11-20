import { DatasetEntry } from '@/lib/shared/types';

export interface BuilderOptions {
  maxTokensPerSession: number;
  mergeSequential: boolean;
  includeGroupSpeakerNames: boolean;
  imputeReactions: boolean;
  identityNames: string[];
  systemMsg: { role: 'system'; content: string };
  skipSystemMessages: boolean;
  tokenizer: (text: string) => number;
  threadTitle?: string;
  isGroup?: boolean;
  platform: string;
}

export class MessageSessionBuilder {
  private currentSession: { role: 'user' | 'assistant'; content: string; sender?: string }[] = [];
  private currentSessionTokens = 0;
  private isFirstInSession = true;
  private firstMsgTimestamp: number | null = null;

  constructor(private opts: BuilderOptions) {}

  /**
   * Add a message to the current session.
   * Returns a completed DatasetEntry if a session boundary was hit (due to token limit).
   */
  public addMessage(
    content: string,
    role: 'user' | 'assistant',
    senderName: string,
    timestampMs: number,
    reactionsJson?: string,
  ): DatasetEntry | null {
    if (this.currentSession.length === 0) {
      this.firstMsgTimestamp = timestampMs;
    }
    let finalContent = content;

    // Speaker names for group chats
    if (this.opts.isGroup && role === 'user' && this.opts.includeGroupSpeakerNames) {
      finalContent = `[${senderName}]: ${finalContent}`;
    }

    // Subject injection at start of session
    if (this.isFirstInSession && this.opts.threadTitle && this.opts.threadTitle !== 'Unknown') {
      finalContent = `[Subject: ${this.opts.threadTitle}]\n\n${finalContent}`;
      this.isFirstInSession = false;
    }

    const msgTokens = this.opts.tokenizer(finalContent) + 4; // +4 for overhead

    // Session Split Check (Token Limit)
    const isFirstResponse = role === 'assistant' && !this.currentSession.some((m) => m.role === 'assistant');

    if (
      this.currentSession.length > 0 &&
      this.currentSessionTokens + msgTokens > this.opts.maxTokensPerSession &&
      !isFirstResponse
    ) {
      // Split occurred!
      const session = this.finalize();

      // Start new session with previous orphans (handled by finalize)
      // then add this message
      this.pushMessage(finalContent, role, msgTokens);
      this._handleReactions(reactionsJson, role);

      return session;
    }

    // Merge Sequential Logic
    let merged = false;
    if (this.opts.mergeSequential && this.currentSession.length > 0) {
      const last = this.currentSession[this.currentSession.length - 1];
      if (last.role === role) {
        last.content += `\n${finalContent}`;
        this.currentSessionTokens += this.opts.tokenizer(`\n${finalContent}`);
        merged = true;
      }
    }

    if (!merged) {
      this.pushMessage(finalContent, role, msgTokens);
    }

    this._handleReactions(reactionsJson, role);

    return null;
  }

  /**
   * Force a session boundary (e.g. on timeout or end of thread).
   * Returns a completed DatasetEntry or null if not valid for training.
   */
  public finalize(): DatasetEntry | null {
    if (this.currentSession.length === 0) {
      return null;
    }

    // Find the last assistant message to ensure the session ends on the target response
    let validEndIndex = this.currentSession.length - 1;
    while (validEndIndex >= 0 && this.currentSession[validEndIndex].role !== 'assistant') {
      validEndIndex--;
    }

    // Capture orphans (messages after the last assistant response) to carry over
    const orphans = this.currentSession.slice(validEndIndex + 1);
    const finalMessages = this.currentSession.slice(0, validEndIndex + 1);

    // Reset state for next session
    this.currentSession = orphans;
    this.currentSessionTokens = orphans.reduce((acc, m) => acc + this.opts.tokenizer(m.content) + 4, 0);
    this.isFirstInSession = orphans.length === 0;
    const sessionTs = this.firstMsgTimestamp;
    this.firstMsgTimestamp = orphans.length > 0 ? sessionTs : null;

    // Quality Check:
    // 1. Must always have an assistant message (the target)
    // 2. Unless in Knowledge mode (assistant-only) or certain platforms (facebook posts), must have a user prompt
    const hasUser = finalMessages.some((m) => m.role === 'user');
    const hasAssistant = finalMessages.some((m) => m.role === 'assistant');

    const isKnowledgeRecord = this.opts.skipSystemMessages;
    const isFacebookTarget = this.opts.platform.toLowerCase().includes('facebook');

    if (!hasAssistant) {
      return null;
    }
    if (!hasUser && !isKnowledgeRecord && !isFacebookTarget && !this.opts.isGroup) {
      return null;
    }

    if (this.opts.skipSystemMessages) {
      const dateStr = sessionTs
        ? new Date(sessionTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown Date';

      const platformLabel = this.opts.platform.charAt(0).toUpperCase() + this.opts.platform.slice(1);
      const header = `[${platformLabel} · ${dateStr}]`;

      // Format: [Platform · Date]
      // [Sender]: Message...
      const combinedContent = finalMessages
        .map((m) => {
          // Omit [Me] and [User] tags in assistant-only knowledge format
          if (m.role === 'assistant') {
            return m.content;
          }
          const speaker = m.sender || 'User';
          if (speaker === 'User') {
            return m.content;
          }
          return `[${speaker}]: ${m.content}`;
        })
        .join('\n');

      return {
        messages: [{ role: 'assistant', content: `${header}\n${combinedContent}` }],
      };
    }

    return {
      messages: [this.opts.systemMsg, ...finalMessages.map(({ role, content }) => ({ role, content }))],
    };
  }

  private pushMessage(content: string, role: 'user' | 'assistant', tokens: number, sender?: string) {
    this.currentSession.push({ role, content, sender });
    this.currentSessionTokens += tokens;
  }

  private _handleReactions(reactionsJson: string | undefined, role: 'user' | 'assistant') {
    if (!this.opts.imputeReactions || !reactionsJson || role === 'assistant') {
      return;
    }

    const reply = this._getReactionReply(reactionsJson);
    if (reply) {
      const reactionTokens = this.opts.tokenizer(reply) + 4;
      // We don't split tokens JUST for reactions usually, but if it pushes over,
      // the NEXT message will trigger the split.
      this.pushMessage(reply, 'assistant', reactionTokens);
    }
  }

  private _getReactionReply(reactionsJson: string): string | null {
    try {
      const reactions = JSON.parse(reactionsJson);
      if (Array.isArray(reactions)) {
        const myReaction = reactions.find((r) => this.opts.identityNames.includes(r.actor));
        if (myReaction) {
          return `[Reacted "${myReaction.reaction}"]`;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }
}
