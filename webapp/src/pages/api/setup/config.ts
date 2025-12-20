import fs from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';

import appConfig from '@/lib/shared/appConfig';
import fileSystem from '@/lib/server/fileSystem';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const currentPath = process.env.WORKSPACE_PATH || 'data';

    try {
      const resolved = fileSystem.resolveSafePath('workspace', currentPath);
      let exists = false;
      try {
        await fs.promises.access(resolved);
        exists = true;
      } catch {}

      return res.status(200).json({ workspacePath: currentPath, exists, resolved });
    } catch {
      return res.status(403).json({ error: 'Current workspace path is outside allowed boundaries' });
    }
  }

  if (req.method === 'POST') {
    const { workspacePath, create } = req.body;
    if (!workspacePath || typeof workspacePath !== 'string') {
      return res.status(400).json({ error: 'Invalid path' });
    }

    let resolved: string;
    try {
      resolved = fileSystem.resolveSafePath('workspace', workspacePath);
    } catch {
      return res
        .status(403)
        .json({ error: 'Permission denied: This location is outside the allowed workspace boundary.' });
    }

    const meta = await fileSystem.getPathMetadata(resolved);

    // 1. Nested workspace check
    if (meta.isNested) {
      return res.status(403).json({ error: 'This location is inside another workspace.' });
    }

    // 2. Active path check (redundant but safe)
    // if (meta.isActive) ... normally we just let them "re-apply" the same path.

    // 3. Writability check
    if (meta.exists && !meta.isWritable) {
      return res.status(403).json({ error: 'Permission denied: Cannot write to this folder.' });
    }

    const { exists, isEmpty } = meta;
    let finalExists = exists;
    let finalEmpty = isEmpty;

    // Handle Creation if not exists
    if (!finalExists && create) {
      try {
        await fs.promises.mkdir(resolved, { recursive: true });
        finalExists = true;
        finalEmpty = true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('CRITICAL: Failed to create workspace directory:', e);
        return res.status(500).json({ error: `Failed to create folder: ${message}. Check permissions.` });
      }
    }

    // Update runtime config only if valid (exists)
    if (finalExists) {
      appConfig.WORKSPACE_PATH = workspacePath;
    }

    return res.status(200).json({ workspacePath, exists: finalExists, resolved, isEmpty: finalEmpty });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
