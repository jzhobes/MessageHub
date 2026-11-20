import fs from 'fs';

import fileSystem from '@/lib/server/fileSystem';
import { getMyNames } from '@/lib/server/identity';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * List the requested folder for File Explorer. Use the filesystem service to resolve the path and
 * enforce the configured root.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestedPath = req.query.path;
  const mode = req.query.mode ?? 'import';
  if (
    (requestedPath !== undefined && typeof requestedPath !== 'string') ||
    (mode !== 'import' && mode !== 'workspace')
  ) {
    return res.status(400).json({ error: 'Invalid path or mode' });
  }
  const extParam = req.query.extensions;
  if (extParam !== undefined && typeof extParam !== 'string') {
    return res.status(400).json({ error: 'Invalid extensions' });
  }

  try {
    const currentPath = fileSystem.resolveSafePath(mode, requestedPath);

    // Parse extensions
    let extensions: string[] | undefined;
    if (extParam) {
      extensions = extParam.split(',').map((e) => (e.startsWith('.') ? e : `.${e}`));
    }

    const parent = fileSystem.getSafeParent(mode, currentPath);
    const meta = mode === 'workspace' ? await fileSystem.getPathMetadata(currentPath) : null;

    if (mode === 'import') {
      try {
        await fs.promises.access(currentPath);
      } catch {
        return res.status(404).json({ error: 'Path not found' });
      }
    }

    // Return the path details without listing files if the folder hasn't been created yet.
    const items = (meta?.exists ?? true) ? await fileSystem.listContents(currentPath, extensions, mode) : [];

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
    console.error('%s:', message, e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : message,
    });
  }
}
