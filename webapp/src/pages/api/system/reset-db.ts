import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import db from '@/lib/server/db';
import appConfig from '@/lib/shared/appConfig';

/**
 * API Handler to reset (delete) the message database.
 * This is a destructive action and requires a POST request.
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

    // 1. Check if it exists
    try {
      await fs.promises.access(dbPath);
    } catch {
      return res.status(200).json({ success: true, message: 'Database does not exist, nothing to reset.' });
    }

    // 2. Close active connection
    db.close();

    // 3. Delete the main DB file and auxiliary WAL files
    const filesToDelete = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`];

    for (const file of filesToDelete) {
      try {
        await fs.promises.access(file);
        await fs.promises.unlink(file);
        console.log(`[Reset] Deleted: ${file}`);
      } catch (e) {
        // Just skip if file doesn't exist, log other errors
        if (e && typeof e === 'object' && 'code' in e && e.code !== 'ENOENT') {
          console.warn(`[Reset] Could not delete ${file}:`, e);
        }
      }
    }

    return res.status(200).json({ success: true, message: 'Database successfully reset.' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Failed to reset database:', e);
    return res.status(500).json({ error: `Failed to reset database: ${message}` });
  }
}
