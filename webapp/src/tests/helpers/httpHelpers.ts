import { EventEmitter } from 'events';

import { createMocks } from 'node-mocks-http';

import type { NextApiRequest, NextApiResponse } from 'next';
import type { MockRequest, MockResponse, RequestOptions, RequestType, ResponseType } from 'node-mocks-http';

export interface SSEEvent {
  type: string;
  payload: unknown;
}

/**
 * Use a real EventEmitter with node-mocks-http so streaming and SSE tests can observe response
 * events.
 */
export function createStreamingMocks<
  TReq extends RequestType = NextApiRequest,
  TRes extends ResponseType = NextApiResponse,
>(options: RequestOptions = {}): { req: MockRequest<TReq>; res: MockResponse<TRes> } {
  return createMocks<TReq, TRes>(options, { eventEmitter: EventEmitter });
}

/**
 * Wait for the mock response to finish writing and end.
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
 * Read structured SSE data events from the mock response body.
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
