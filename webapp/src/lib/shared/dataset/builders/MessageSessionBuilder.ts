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
   * Add a message and return the finished `DatasetEntry` if it pushes the session over the token
   * limit.
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

    // Include the subject at the start of the session.
    if (this.isFirstInSession && this.opts.threadTitle && this.opts.threadTitle !== 'Unknown') {
      finalContent = `[Subject: ${this.opts.threadTitle}]\n\n${finalContent}`;
      this.isFirstInSession = false;
    }

    const msgTokens = this.opts.tokenizer(finalContent) + 4; // Allow four extra tokens for message overhead.

    // Session Split Check (Token Limit)
    const isFirstResponse = role === 'assistant' && !this.currentSession.some((m) => m.role === 'assistant');

    if (
      this.currentSession.length > 0 &&
      this.currentSessionTokens + msgTokens > this.opts.maxTokensPerSession &&
      !isFirstResponse
    ) {
      // Split occurred!
      const session = this.finalize();

      // Start the next session with anything finalize carried over.
      // Add the current message after those carryovers.
      this.pushMessage(finalContent, role, msgTokens);
      this._handleReactions(reactionsJson, role);

      return session;
    }

    // Merge consecutive messages with the same role and speaker.
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
   * Finish the session, for example after a timeout or at the end of a thread. Return a
   * `DatasetEntry` if it qualifies for training, or `null` if it doesn't.
   */
  public finalize(): DatasetEntry | null {
    if (this.currentSession.length === 0) {
      return null;
    }

    // End the session at the last assistant message so it has a target response.
    let validEndIndex = this.currentSession.length - 1;
    while (validEndIndex >= 0 && this.currentSession[validEndIndex].role !== 'assistant') {
      validEndIndex--;
    }

    // Carry anything after the last assistant response into the next session.
    const orphans = this.currentSession.slice(validEndIndex + 1);
    const finalMessages = this.currentSession.slice(0, validEndIndex + 1);

    // Reset state for next session
    this.currentSession = orphans;
    this.currentSessionTokens = orphans.reduce((acc, m) => acc + this.opts.tokenizer(m.content) + 4, 0);
    this.isFirstInSession = orphans.length === 0;
    const sessionTs = this.firstMsgTimestamp;
    this.firstMsgTimestamp = orphans.length > 0 ? sessionTs : null;

    // Every session needs an assistant message as its target.
    // Require a user prompt too, except for knowledge records, Facebook, and group chats.
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
          // Leave out speaker tags in assistant-only knowledge exports.
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
      // Reactions count toward the budget.
      // If they push us over, split when the next message comes in.
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
