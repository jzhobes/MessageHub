import fs from 'fs';
import path from 'path';

import fileSystem from '@/lib/server/fileSystem';
import { setupSSE } from '@/lib/server/sse';
import appConfig from '@/lib/shared/appConfig';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const files: string[] = req.body.files;
  const operation: 'copy' | 'move' = req.body.operation || 'copy';

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }

  // Setup SSE
  const stream = setupSSE(res, { heartbeat: true });
  const targetDir = appConfig.WORKSPACE_PATH;

  try {
    // 1. Jail Destination: Must be within configured workspace
    let targetDirReal: string;
    try {
      targetDirReal = fileSystem.resolveSafePath('workspace', targetDir);
    } catch {
      throw new Error('PERMISSION_DENIED: Workspace target is outside allowed boundaries.');
    }

    // Ensure data dir exists
    if (!fs.existsSync(targetDirReal)) {
      stream.send('log', `Creating target directory: ${targetDirReal}`);
      await fs.promises.mkdir(targetDirReal, { recursive: true });
    }

    stream.send('log', `Starting ${operation} of ${files.length} files to ${targetDirReal}`);

    let count = 0;
    for (const sourcePathRaw of files) {
      count++;
      let sourcePathAbs: string;
      try {
        // 2. Jail Source: Must be within ROOT_IMPORT_PATH
        sourcePathAbs = fileSystem.resolveSafePath('import', sourcePathRaw);
      } catch {
        stream.send('log', `Skipping ${sourcePathRaw}: Access Denied (outside import root)`);
        continue;
      }

      const fileName = path.basename(sourcePathAbs);
      const destPath = path.join(targetDirReal, fileName);

      try {
        if (!fs.existsSync(sourcePathAbs)) {
          throw new Error(`Source file does not exist: ${sourcePathAbs}`);
        }

        // 3. Protection: Don't overwrite existing workspace files
        if (fs.existsSync(destPath)) {
          stream.send('log', `Skipping ${fileName}: File already exists in workspace.`);
          stream.send('progress', {
            index: count,
            total: files.length,
            file: fileName,
            status: 'success',
          });
          continue;
        }

        if (operation === 'move') {
          try {
            await fs.promises.rename(sourcePathAbs, destPath);
          } catch (e) {
            // Handle cross-device moves
            if (e && typeof e === 'object' && 'code' in e && e.code === 'EXDEV') {
              await fs.promises.copyFile(sourcePathAbs, destPath);
              await fs.promises.unlink(sourcePathAbs);
            } else {
              throw e;
            }
          }
        } else {
          await fs.promises.copyFile(sourcePathAbs, destPath);
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
