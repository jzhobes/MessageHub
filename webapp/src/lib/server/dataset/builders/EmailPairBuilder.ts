import { redactPII, redactTrackingNumbers } from '@/lib/server/piiUtils';

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
   * Add an inbound email (from someone else).
   * Best practice: keep ONLY the most recent inbound until a reply is sent.
   */
  addInbound(raw: string, senderName?: string): void {
    const cleaned = this._cleanInbound(raw, senderName);
    if (!cleaned) {
      return;
    }
    this.pendingInbound = cleaned;
  }

  /**
   * Add an outbound email (from the user).
   * Returns a finalized user->assistant pair if we have a pending inbound.
   * Otherwise returns null (drops outbound-only by default).
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

    // Inject subject ONCE, and only on the first emitted pair.
    if (this.opts.injectSubjectOnce && !this.hasInjectedSubject && this.opts.subject) {
      inboundWithSubject = `[Subject: ${this.opts.subject}]\n\n${inboundWithSubject}`;
      this.hasInjectedSubject = true;
    }

    const pair: Msg[] = [
      { role: 'user', content: inboundWithSubject },
      { role: 'assistant', content: cleaned },
    ];

    // Consume inbound to prevent reusing it across multiple outbounds.
    this.pendingInbound = null;

    return pair;
  }

  private _cleanInbound(content: string, senderName?: string): string | null {
    let s = content.trim();
    if (!s) {
      return null;
    }

    // Strip long quoted history and signatures BEFORE prepending sender name.
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

    // Outbound should not include pasted inbound history
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
  // Cuts common quoted blocks. Expand if your exports differ.
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
  // Keep this conservative; don’t nuke real content.
  const lines = s.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const t = line.trim();

    if (!t) {
      kept.push('');
      continue;
    }

    // Drop common corporate slogan lines (example-specific)
    if (/^(patient first|open communication|helps each other|reliable|embraces change|scale thinking)\b/i.test(t)) {
      continue;
    }

    kept.push(line);
  }

  // Collapse excessive blank lines
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

export default EmailPairBuilder;
export type { Msg, Role, EmailBuilderOptions };
