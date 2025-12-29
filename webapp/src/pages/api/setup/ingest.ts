import { ingestionManager } from '@/lib/server/ingestionManager';
import { setupSSE } from '@/lib/server/sse';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Setup SSE
  const stream = setupSSE(res, { heartbeat: true });

  const deleteArchives = req.query.deleteArchives === 'true';
  const child = await ingestionManager.start(deleteArchives);
  const initialState = ingestionManager.getState();

  // 1. Replay buffered logs
  for (const log of initialState.logs) {
    stream.send(log.type, log.payload);
  }

  // 2. Already done?
  if (!initialState.isRunning && initialState.isComplete) {
    stream.send('done', { code: initialState.exitCode });
    stream.close();
    return;
  }

  // 3. Attach current listeners
  const onStdout = (data: Buffer | string) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        stream.send('stdout', line.trim());
      }
    }
  };

  const onStderr = (data: Buffer | string) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        stream.send('stderr', line.trim());
      }
    }
  };

  const onClose = (code: number) => {
    stream.send('done', { code });
    stream.close();
  };

  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);
  child.on('close', onClose);

  req.on('close', () => {
    // Only remove local listeners, DON'T kill the child.
    child.stdout?.removeListener('data', onStdout);
    child.stderr?.removeListener('data', onStderr);
    child.removeListener('close', onClose);
    stream.close();
  });
}
