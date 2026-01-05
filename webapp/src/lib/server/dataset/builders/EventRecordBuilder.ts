export interface EventBuilderOptions {
  identityName: string;
}

interface EventEntry {
  timestampMs: number;
  content: string;
  platform: string;
  threadTitle?: string;
}

export class EventRecordBuilder {
  private entries: EventEntry[] = [];

  constructor(private opts: EventBuilderOptions) {}

  public addLine(content: string, timestampMs: number, platform: string, threadTitle?: string): void {
    this.entries.push({
      timestampMs,
      content,
      platform,
      threadTitle,
    });
  }

  public finalize(): string {
    if (this.entries.length === 0) {
      return '';
    }

    // 1. Sort entries chronologically
    const sorted = [...this.entries].sort((a, b) => a.timestampMs - b.timestampMs);

    // 2. Build lines with year transitions
    const lines: string[] = [];
    let currentYear: number | null = null;

    for (const entry of sorted) {
      const dateObj = new Date(entry.timestampMs);
      const year = dateObj.getFullYear();
      const displayDate = dateObj.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });

      // Handle Year Transitions
      if (currentYear !== null && year !== currentYear) {
        lines.push('\n---\n');
      }
      if (year !== currentYear) {
        lines.push(`\n## ${year}\n`);
        currentYear = year;
      }

      const action = this._mapAction(entry.content, entry.platform);
      const title = entry.threadTitle || 'Unknown Event';
      lines.push(`- **${displayDate}** – ${action} *${title}*.`);
    }

    const preamble = `# Facebook Events Timeline

This document contains a chronological record of Facebook events.
Each entry notes the event title, the date, and the type of interaction.

---`;

    const postamble = `
---

## Notes for Voice Interpretation

When referencing this timeline:
- Treat “Joined” as attended or planned attendance
- Treat “Expressed interest” as consideration, not confirmation
- Treat “Created” as events personally organized
`;

    return `${preamble}\n${lines.join('\n')}\n${postamble}`;
  }

  private _mapAction(content: string, platform: string): string {
    const c = content.trim();

    if (platform === 'facebook' || platform === 'Facebook') {
      if (c === 'Joined Event') {
        return 'Joined';
      }
      if (c === 'Interested in Event') {
        return 'Expressed interest in';
      }
      if (c === 'Created Event') {
        return 'Joined and later created';
      } // Common FB pattern for self-owned events
    }

    if (c.toLowerCase().includes('joined')) {
      return 'Joined';
    }
    if (c.toLowerCase().includes('interested')) {
      return 'Expressed interest in';
    }
    if (c.toLowerCase().includes('created')) {
      return 'Created';
    }

    return 'Interacted with';
  }
}
