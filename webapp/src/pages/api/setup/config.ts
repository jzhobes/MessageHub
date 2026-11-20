import fs from 'fs';

import db from '@/lib/server/db';
import { persistWorkspacePath, serializeWorkspacePath } from '@/lib/server/env';
import fileSystem from '@/lib/server/fileSystem';
import appConfig from '@/lib/shared/appConfig';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Read or change the workspace path.
 *
 * - GET checks the active `WORKSPACE_PATH` against the workspace root and reports whether it
 *   exists.
 * - POST checks the requested path for safety, nesting, and write access. Set `create: true` to
 *   create the folder. Close SQLite before switching `appConfig` and save the path to .env.
 */
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

    try {
      serializeWorkspacePath(workspacePath);
    } catch {
      return res.status(400).json({ error: 'Invalid workspace path for configuration' });
    }

    let resolved: string;
    try {
      resolved = fileSystem.resolveSafePath('workspace', workspacePath);
      serializeWorkspacePath(resolved);
    } catch {
      return res
        .status(403)
        .json({ error: 'Permission denied: This location is outside the allowed workspace boundary.' });
    }

    let meta;
    try {
      meta = await fileSystem.getPathMetadata(resolved);
    } catch {
      return res.status(403).json({ error: 'Permission denied: Cannot inspect this folder.' });
    }

    // 1. Nested workspace check
    if (meta.isNested) {
      return res.status(403).json({ error: 'This location is inside another workspace.' });
    }

    // 2. Active path check
    // Reusing the current path is fine. Refresh and save the configuration again.

    // 3. Writability check
    if (meta.exists && !meta.isWritable) {
      return res.status(403).json({ error: 'Permission denied: Cannot write to this folder.' });
    }

    const { exists, isEmpty } = meta;
    let finalExists = exists;
    let finalEmpty = isEmpty;

    // Create the folder if it's missing and creation was requested.
    if (!finalExists && create) {
      try {
        resolved = fileSystem.resolveSafePath('workspace', resolved);
        await fs.promises.mkdir(resolved, { recursive: true });
        resolved = fileSystem.resolveSafePath('workspace', resolved);
        finalExists = true;
        finalEmpty = true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('CRITICAL: Failed to create workspace directory:', e);
        return res.status(500).json({ error: `Failed to create folder: ${message}. Check permissions.` });
      }
    }

    // Switch the active workspace once the path exists and passes validation.
    if (finalExists) {
      // Close SQLite first so the old workspace connection doesn't stick around.
      db.close();
      appConfig.WORKSPACE_PATH = resolved;
      try {
        await persistWorkspacePath(resolved);
      } catch (e) {
        console.error('Failed to persist workspace path to .env:', e);
      }
    }

    return res.status(200).json({
      workspacePath,
      exists: finalExists,
      resolved,
      isEmpty: finalEmpty,
      isExistingWorkspace: meta.isExistingWorkspace,
    });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
