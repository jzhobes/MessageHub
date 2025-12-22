import { NextApiResponse } from 'next';

/**
 * Interface for the return value of initSSE
 */
export interface SSEStream {
  /**
   * Sends a structured data event to the client.
   * Format: data: {"type": "type", "payload": payload} \n\n
   */
  send: (type: string, payload: unknown) => void;
  /**
   * Cleans up resources (e.g. heartbeat) and closes the response stream.
   */
  close: () => void;
}

/**
 * Initializes a NextApiResponse for Server-Sent Events (SSE).
 * Sets proper headers and provides a convenience helper for sending events.
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
    }, 5000); // 5s is usually sufficient for keeping connection alive
  }

  const close = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    res.end();
  };

  return { send, close };
}
