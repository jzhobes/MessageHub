import { EventEmitter } from 'events';

import { createMocks } from 'node-mocks-http';

import type { NextApiRequest, NextApiResponse } from 'next';
import type { MockRequest, MockResponse, RequestOptions, RequestType, ResponseType } from 'node-mocks-http';

export interface SSEEvent {
  type: string;
  payload: unknown;
}

/**
 * Creates node-mocks-http request/response mocks backed by a real EventEmitter for streaming/SSE tests.
 */
export function createStreamingMocks<
  TReq extends RequestType = NextApiRequest,
  TRes extends ResponseType = NextApiResponse,
>(options: RequestOptions = {}): { req: MockRequest<TReq>; res: MockResponse<TRes> } {
  return createMocks<TReq, TRes>(options, { eventEmitter: EventEmitter });
}

/**
 * Resolves once a mock HTTP response stream has finished writing and ended.
 */
export function waitForStreamEnd(res: MockResponse<NextApiResponse>): Promise<void> {
  if (res.writableEnded || res._isEndCalled()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onDone = () => {
      res.removeListener('end', onDone);
      res.removeListener('finish', onDone);
      resolve();
    };
    res.once('end', onDone);
    res.once('finish', onDone);
  });
}

/**
 * Parses `data: {"type": ..., "payload": ...}\n\n` chunks from an SSE response body.
 */
export function parseSSEEvents(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = raw.split('\n\n');

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) {
      continue;
    }
    const jsonStr = trimmed.slice('data: '.length);
    events.push(JSON.parse(jsonStr) as SSEEvent);
  }

  return events;
}
