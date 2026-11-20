import fs from 'fs';
import path from 'path';

import db from '@/lib/server/db';
import appConfig from '@/lib/shared/appConfig';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Clear the message database and imported workspace data. Requires POST with `confirm: "RESET"`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { confirm } = req.body;

  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Invalid confirmation' });
  }

  try {
    const dbPath = path.join(appConfig.WORKSPACE_PATH, 'messagehub.db');
    console.log(`Resetting database at ${dbPath}`);

    // 1. Close active connection and delete DB if it exists
    const dbExists = db.exists();
    if (dbExists) {
      db.close();

      const dbPath = path.join(appConfig.WORKSPACE_PATH, 'messagehub.db');
      const previewCachePath = path.join(appConfig.WORKSPACE_PATH, 'preview_cache.json');
      const filesToDelete = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`, previewCachePath];

      for (const file of filesToDelete) {
        try {
          await fs.promises.unlink(file);
          console.log(`[Reset] Deleted file: ${file}`);
        } catch (e) {
          // Keep going if the file is already gone.
          if (e && typeof e === 'object' && 'code' in e && e.code !== 'ENOENT') {
            console.warn('[Reset] Could not delete file %s:', file, e);
          }
        }
      }
    }

    // 2. Delete platform directories and metadata
    const dirsToDelete = ['Facebook', 'Instagram', 'Voice', 'Google Chat', 'Mail', 'Takeout', '.processed'];

    for (const d of dirsToDelete) {
      const dirPath = path.join(appConfig.WORKSPACE_PATH, d);
      try {
        await fs.promises.rm(dirPath, { recursive: true, force: true });
        console.log(`[Reset] Deleted directory: ${dirPath}`);
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code !== 'ENOENT') {
          console.warn('[Reset] Could not delete directory %s:', dirPath, e);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Workspace data successfully reset.',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Failed to reset database:', e);
    return res.status(500).json({ error: `Failed to reset database: ${message}` });
  }
}
