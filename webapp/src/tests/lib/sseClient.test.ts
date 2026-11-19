import { describe, expect, it, vi } from 'vitest';

import { createSSEParser, readSSEStream, SSEEvent } from '@/lib/shared/sseClient';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('sseClient', () => {
  it('buffers partial SSE frames across chunks and ignores keepalive comments', () => {
    const parser = createSSEParser();

    expect(parser.feed(': keepalive\n\ndata: {"type":"stdout","pay')).toEqual([]);
    expect(parser.feed('load":"hello"}\n\n')).toEqual([{ type: 'stdout', payload: 'hello' }]);
    expect(parser.feed('data: {"type":"done","payload":{"code":0}}')).toEqual([]);
    expect(parser.flush()).toEqual([{ type: 'done', payload: { code: 0 } }]);
  });

  it('handles multiple events in one chunk, CRLF delimiters, and trailing frame flush on EOF', async () => {
    const stream = streamFromChunks([
      'data: {"type":"log","payload":"one"}\r\n\r\ndata: {"type":"log","payload":"tw',
      'o"}\r\n\r\n: keepalive\n\ndata: {"type":"done","payload":{"code":0}}',
    ]);

    const events: SSEEvent[] = [];
    await readSSEStream(stream.getReader(), (ev) => {
      events.push(ev);
    });

    expect(events).toEqual([
      { type: 'log', payload: 'one' },
      { type: 'log', payload: 'two' },
      { type: 'done', payload: { code: 0 } },
    ]);
  });

  it('stops reading and cancels reader when callback returns false', async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const encoder = new TextEncoder();
    const reader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: encoder.encode(
          'data: {"type":"done","payload":{"code":0}}\n\ndata: {"type":"log","payload":"after"}\n\n',
        ),
      }),
      cancel: cancelSpy,
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const received: SSEEvent[] = [];
    await readSSEStream(reader, (ev) => {
      received.push(ev);
      if (ev.type === 'done') {
        return false;
      }
    });

    expect(received).toEqual([{ type: 'done', payload: { code: 0 } }]);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
