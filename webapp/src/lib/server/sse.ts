import { NextApiResponse } from 'next';

/**
 * Helpers returned for an open SSE response.
 */
export interface SSEStream {
  /**
   * Send one structured event as `data: {"type": "type", "payload": payload}\n\n`.
   */
  send: (type: string, payload: unknown) => void;
  /**
   * Stop the heartbeat and close the response stream.
   */
  close: () => void;
}

/**
 * Set up a Next.js response for SSE and return helpers for sending events and closing the stream.
 */
export function setupSSE(res: NextApiResponse, options: { heartbeat?: boolean } = {}): SSEStream {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type: string, payload: unknown) => {
    res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
  };

  let heartbeatInterval: NodeJS.Timeout | null = null;
  if (options.heartbeat) {
    heartbeatInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 5000); // A heartbeat every 5 seconds is usually enough to keep the connection open.
  }

  const close = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    res.end();
  };

  return { send, close };
}
