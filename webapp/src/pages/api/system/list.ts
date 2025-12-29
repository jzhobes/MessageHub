import fs from 'fs';

import fileSystem from '@/lib/server/fileSystem';
import { getMyNames } from '@/lib/server/identity';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * API Handler to list directory contents for the file explorer.
 * Leverages FileSystem manager class for security and path resolution.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestedPath = req.query.path as string | undefined;
  const mode = (req.query.mode as 'import' | 'workspace') || 'import';

  try {
    const currentPath = fileSystem.resolveSafePath(mode, requestedPath);

    // Parse extensions
    const extParam = req.query.extensions as string | undefined;
    let extensions: string[] | undefined;
    if (extParam) {
      extensions = extParam.split(',').map((e) => (e.startsWith('.') ? e : `.${e}`));
    }

    const parent = fileSystem.getSafeParent(mode, currentPath);
    const meta = mode === 'workspace' ? await fileSystem.getPathMetadata(currentPath) : null;

    // In import mode, we still 404 if not exists
    if (mode === 'import' && (!meta || !meta.exists)) {
      // Manual exists check if meta is null (import mode)
      let actualExists = true;
      if (!meta) {
        try {
          await fs.promises.access(currentPath);
        } catch {
          actualExists = false;
        }
      }
      if (!actualExists) {
        return res.status(404).json({ error: 'Path not found' });
      }
    }

    // If it doesn't exist, we don't try to list contents
    const items = (meta?.exists ?? true) ? await fileSystem.listContents(currentPath, extensions) : [];

    return res.status(200).json({
      path: currentPath,
      parent,
      items,
      meta,
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'PERMISSION_DENIED') {
      const foundName = (await getMyNames()).find((n) => n !== 'Me' && !!n.trim());
      const firstName = foundName?.split(' ')[0] ?? null;

      const message = `Access denied: I'm sorry${firstName ? `, ${firstName}` : ''}. I'm afraid I can't do that.`;
      return res.status(403).json({ error: message });
    }

    const message = 'Failed to list directory';
    console.error(`${message}:`, e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : message,
    });
  }
}
