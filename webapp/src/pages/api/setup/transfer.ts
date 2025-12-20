import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import appConfig from '@/lib/shared/appConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { files, operation } = req.body; // files: string[], operation: 'copy' | 'move'

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }

  const targetDir = appConfig.WORKSPACE_PATH;
  const results: { file: string; status: string; error?: string }[] = [];

  try {
    // Ensure data dir exists
    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }

    for (const sourcePath of files) {
      const fileName = path.basename(sourcePath);
      const destPath = path.join(targetDir, fileName);

      try {
        if (operation === 'move') {
          // Rename (Move)
          // If cross-device link error (EXDEV), fallback to copy+unlink
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
          // Copy
          await fs.promises.copyFile(sourcePath, destPath);
        }
        results.push({ file: fileName, status: 'success' });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Failed to ${operation} ${sourcePath}`, e);
        results.push({ file: fileName, status: 'error', error: message });
      }
    }

    res.status(200).json({ success: true, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message || 'Transfer failed' });
  }
}
