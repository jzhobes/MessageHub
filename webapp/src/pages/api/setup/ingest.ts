import fileSystem from '@/lib/server/fileSystem';
import { ingestionManager } from '@/lib/server/ingestionManager';
import { setupSSE } from '@/lib/server/sse';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Start ingestion with POST or reconnect to the job already running. Replay buffered logs, then
 * stream stdout and stderr over SSE.
 * Extract any supplied `files` in place from within `ROOT_IMPORT_PATH`. When the client
 * disconnects, detach its listeners and leave ingestion running.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const deleteArchives =
    typeof body.deleteArchives === 'boolean' ? body.deleteArchives : req.query.deleteArchives === 'true';

  const resolvedFiles: string[] = [];
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === 'string')) {
      return res.status(400).json({ error: 'Invalid files list' });
    }
    for (const filePath of body.files) {
      try {
        resolvedFiles.push(fileSystem.resolveSafePath('import', filePath));
      } catch {
        return res.status(403).json({
          error: 'PERMISSION_DENIED: Archive path is outside allowed import boundaries.',
        });
      }
    }
  }

  // Setup SSE
  const stream = setupSSE(res, { heartbeat: true });

  const child = await ingestionManager.start(deleteArchives, resolvedFiles);
  const initialState = ingestionManager.getState();

  // Send what happened before this client connected.
  for (const log of initialState.logs) {
    stream.send(log.type, log.payload);
  }

  // Check whether ingestion finished before we attached.
  if (!initialState.isRunning && initialState.isComplete) {
    stream.send('done', { code: initialState.exitCode });
    stream.close();
    return;
  }

  // Forward new events to this client.
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
    // Detach this client's listeners and let the child process keep running.
    child.stdout?.removeListener('data', onStdout);
    child.stderr?.removeListener('data', onStderr);
    child.removeListener('close', onClose);
    stream.close();
  });
}
