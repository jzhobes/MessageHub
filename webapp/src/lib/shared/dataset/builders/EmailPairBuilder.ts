import { redactPII, redactTrackingNumbers } from '@/lib/shared/piiUtils';

type Role = 'system' | 'user' | 'assistant';
type Msg = { role: Role; content: string };

interface EmailBuilderOptions {
  userName?: string;
  injectSubjectOnce?: boolean;
  subject?: string;
  dropOutboundOnly?: boolean;
  includeSenderNamePrefix?: boolean;
  redactPII?: boolean;
  redactTrackingNumbers?: boolean;
}

class EmailPairBuilder {
  private pendingInbound: string | null = null;
  private hasInjectedSubject = false;

  constructor(private opts: EmailBuilderOptions) {}

  /**
   * Keep the latest incoming email until the user replies.
   */
  addInbound(raw: string, senderName?: string): void {
    const cleaned = this._cleanInbound(raw, senderName);
    if (!cleaned) {
      return;
    }
    this.pendingInbound = cleaned;
  }

  /**
   * Pair the user's reply with the pending inbound email. Return `null` if there's no inbound
   * context to pair it with.
   */
  addOutbound(raw: string): Msg[] | null {
    const cleaned = this._cleanOutbound(raw);
    if (!cleaned) {
      return null;
    }

    const inbound = this.pendingInbound;

    if (!inbound) {
      // Initiated email with no inbound context.
      if (this.opts.dropOutboundOnly === false) {
        let prompt = `Write this email as ${this.opts.userName || 'the user'}:`;
        if (this.opts.injectSubjectOnce && !this.hasInjectedSubject && this.opts.subject) {
          prompt = `[Subject: ${this.opts.subject}]\n\n${prompt}`;
          this.hasInjectedSubject = true;
        }
        return [
          { role: 'user', content: prompt },
          { role: 'assistant', content: cleaned },
        ];
      }
      return null;
    }

    let inboundWithSubject = inbound;

    // Put the subject in the first emitted pair only.
    if (this.opts.injectSubjectOnce && !this.hasInjectedSubject && this.opts.subject) {
      inboundWithSubject = `[Subject: ${this.opts.subject}]\n\n${inboundWithSubject}`;
      this.hasInjectedSubject = true;
    }

    const pair: Msg[] = [
      { role: 'user', content: inboundWithSubject },
      { role: 'assistant', content: cleaned },
    ];

    // Clear the inbound once paired so we don't attach it to another reply.
    this.pendingInbound = null;

    return pair;
  }

  private _cleanInbound(content: string, senderName?: string): string | null {
    let s = content.trim();
    if (!s) {
      return null;
    }

    // Strip quoted history and signatures before adding the sender's name.
    s = stripQuotedHistory(s);
    s = stripCommonEmailBoilerplate(s);

    if (this.opts.redactPII) {
      s = redactPII(s);
    }
    if (this.opts.redactTrackingNumbers) {
      s = redactTrackingNumbers(s);
    }

    s = s.trim();
    if (!s) {
      return null;
    }

    if (this.opts.includeSenderNamePrefix && senderName) {
      const prefix = `[${senderName}]:`;
      if (!s.startsWith(prefix)) {
        s = `${prefix} ${s}`;
      }
    }

    return s;
  }

  private _cleanOutbound(content: string): string | null {
    let s = content.trim();
    if (!s) {
      return null;
    }

    // Keep pasted context from repeating in the outbound reply.
    s = stripQuotedHistory(s);

    if (this.opts.redactPII) {
      s = redactPII(s);
    }
    if (this.opts.redactTrackingNumbers) {
      s = redactTrackingNumbers(s);
    }

    return s.trim() || null;
  }
}

function stripQuotedHistory(s: string): string {
  // Cut common quote blocks. Add more markers here if another export format needs them.
  const patterns = [
    /\nOn .* wrote:\n[\s\S]*$/i,
    /\nFrom:\s.*\nSent:\s.*\nTo:\s.*\nSubject:\s.*\n[\s\S]*$/i,
    /\n-+\s*Original Message\s*-+\n[\s\S]*$/i,
    /\nBegin forwarded message:\n[\s\S]*$/i,
    /\n_{5,}\n[\s\S]*$/i,
    /\n={5,}\n[\s\S]*$/i,
  ];
  for (const r of patterns) {
    s = s.replace(r, '');
  }
  return s;
}

function stripCommonEmailBoilerplate(s: string): string {
  // Keep the match narrow so we don't lose real message text.
  const lines = s.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const t = line.trim();

    if (!t) {
      kept.push('');
      continue;
    }

    // Drop the corporate slogan lines we know about.
    if (/^(patient first|open communication|helps each other|reliable|embraces change|scale thinking)\b/i.test(t)) {
      continue;
    }

    kept.push(line);
  }

  // Collapse excessive blank lines
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

export default EmailPairBuilder;
export { stripQuotedHistory, stripCommonEmailBoilerplate };
export type { Msg, Role, EmailBuilderOptions };
