export interface SSEEvent {
  type: string;
  payload: unknown;
}

export interface SSEParser {
  feed: (text: string) => SSEEvent[];
  flush: () => SSEEvent[];
}

function parseSSEFrame(rawFrame: string): SSEEvent | null {
  const lines = rawFrame.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join('\n')) as SSEEvent;
  } catch (e) {
    console.error('Failed to parse SSE message', e);
    return null;
  }
}

/**
 * Creates a stateful SSE parser that buffers incomplete frames across arbitrary network chunks.
 */
export function createSSEParser(): SSEParser {
  let buffer = '';

  const drainComplete = (): SSEEvent[] => {
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    const events: SSEEvent[] = [];
    for (const part of parts) {
      const parsed = parseSSEFrame(part);
      if (parsed) {
        events.push(parsed);
      }
    }
    return events;
  };

  return {
    feed(text: string): SSEEvent[] {
      buffer += text.replace(/\r\n/g, '\n');
      return drainComplete();
    },

    flush(): SSEEvent[] {
      if (!buffer.trim()) {
        buffer = '';
        return [];
      }
      const parsed = parseSSEFrame(buffer);
      buffer = '';
      return parsed ? [parsed] : [];
    },
  };
}

/**
 * Reads an SSE `ReadableStreamDefaultReader` using a buffered parser until EOF or `onEvent` returns `false`.
 */
export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: SSEEvent) => boolean | void | Promise<boolean | void>,
): Promise<void> {
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  let stopped = false;

  try {
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        const remaining = [...(tail ? parser.feed(tail) : []), ...parser.flush()];
        for (const event of remaining) {
          if ((await onEvent(event)) === false) {
            break;
          }
        }
        break;
      }

      const chunkText = decoder.decode(value, { stream: true });
      for (const event of parser.feed(chunkText)) {
        if ((await onEvent(event)) === false) {
          stopped = true;
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if already released/closed
    }
  }
}
