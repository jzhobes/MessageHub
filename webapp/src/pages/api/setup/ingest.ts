import fileSystem from '@/lib/server/fileSystem';
import { ingestionManager } from '@/lib/server/ingestionManager';
import { setupSSE } from '@/lib/server/sse';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Starts or attaches to the singleton ingestion process over SSE (`POST`), replaying buffered logs
 * and streaming live stdout/stderr. Optional `files` in the request body are jailed to
 * `ROOT_IMPORT_PATH` and extracted directly without copying. Client disconnects detach listeners
 * without terminating the underlying child process.
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
