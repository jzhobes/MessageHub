import fs from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import appConfig from '@/lib/shared/appConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Determine Project Root (parent of webapp if running inside webapp)
  const currentDir = process.cwd();
  const projectRoot = path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;

  if (req.method === 'GET') {
    // 1204: Just use what's currently configured in process.env or fallback
    // We assume setRuntimeDataPath updates process.env.DATA_PATH
    const currentPath = process.env.DATA_PATH ?? 'data';

    // Now resolve it to check existence
    const resolved = path.isAbsolute(currentPath) ? currentPath : path.resolve(projectRoot, currentPath);

    let exists = false;
    try {
      await fs.promises.access(resolved);
      exists = true;
    } catch {}

    return res.status(200).json({ dataPath: currentPath, exists, resolved });
  }

  if (req.method === 'POST') {
    const { dataPath, create } = req.body;
    if (!dataPath || typeof dataPath !== 'string') {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const resolved = path.isAbsolute(dataPath) ? dataPath : path.resolve(projectRoot, dataPath);
    let exists = false;
    try {
      await fs.promises.access(resolved);
      exists = true;
    } catch {}

    // Check emptiness if it exists
    let isEmpty = true;
    if (exists) {
      try {
        const files = await fs.promises.readdir(resolved);
        // filter out system files if needed, but for now strict empty
        if (files.filter((f) => f !== '.DS_Store' && f !== 'thumbs.db').length > 0) {
          isEmpty = false;
        }
      } catch {
        // If we can't read it (permission?), treat as not empty or error?
        // simple fallback
      }
    }

    // Handle Creation if not exists
    if (!exists && create) {
      try {
        await fs.promises.mkdir(resolved, { recursive: true });
        exists = true;
        isEmpty = true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return res.status(500).json({ error: `Failed to create folder: ${message}. Check permissions.` });
      }
    }

    // Update runtime config only if valid (exists)
    if (exists) {
      appConfig.DATA_PATH = dataPath;
    }

    return res.status(200).json({ dataPath, exists, resolved, isEmpty });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
