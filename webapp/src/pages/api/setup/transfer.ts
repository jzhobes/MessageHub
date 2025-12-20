import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { setupSSE } from '@/lib/server/sse';
import appConfig from '@/lib/shared/appConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  let files: string[] = [];
  let operation: 'copy' | 'move' = 'copy';

  if (req.method === 'POST') {
    files = req.body.files;
    operation = req.body.operation;
  } else {
    try {
      files = JSON.parse(req.query.files as string);
      operation = (req.query.operation as 'copy' | 'move') || 'copy';
    } catch {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }

  // Setup SSE
  const stream = setupSSE(res, { heartbeat: true });

  const targetDir = appConfig.WORKSPACE_PATH;

  try {
    // Ensure data dir exists
    if (!fs.existsSync(targetDir)) {
      stream.send('log', `Creating target directory: ${targetDir}`);
      await fs.promises.mkdir(targetDir, { recursive: true });
    }

    stream.send('log', `Starting ${operation} of ${files.length} files to ${targetDir}`);

    let count = 0;
    for (const sourcePath of files) {
      count++;
      const fileName = path.basename(sourcePath);
      const destPath = path.join(targetDir, fileName);

      try {
        if (operation === 'move') {
          try {
            await fs.promises.rename(sourcePath, destPath);
          } catch (e) {
            if (e && typeof e === 'object' && 'code' in e && e.code === 'EXDEV') {
              await fs.promises.copyFile(sourcePath, destPath);
              await fs.promises.unlink(sourcePath);
            } else {
              throw e;
            }
          }
        } else {
          await fs.promises.copyFile(sourcePath, destPath);
        }

        stream.send('progress', {
          index: count,
          total: files.length,
          file: fileName,
          status: 'success',
        });
      } catch (e) {
        stream.send('progress', {
          index: count,
          total: files.length,
          file: fileName,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    stream.send('done', { success: true });
  } catch (e) {
    stream.send('error', e instanceof Error ? e.message : String(e));
  } finally {
    stream.close();
  }
}
