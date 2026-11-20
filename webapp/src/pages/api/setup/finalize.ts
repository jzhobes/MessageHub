import { spawnSync } from 'child_process';

import db from '@/lib/server/db';
import { getIngestScriptPath, getPythonPath } from '@/lib/server/python';
import appConfig from '@/lib/shared/appConfig';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Close SQLite and make sure `messagehub.db` exists before returning. If it's missing, run
 * `scripts/ingest.py` synchronously so Python creates the authoritative schema.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const currentPath = appConfig.WORKSPACE_PATH;
  if (!currentPath) {
    return res.status(400).json({ error: 'No runtime WORKSPACE_PATH set. Complete setup first.' });
  }

  try {
    // Close our connection before Python opens the DB.
    db.close();

    // Let Python initialize the schema if the database is missing.
    if (!db.exists()) {
      const pythonPath = await getPythonPath();
      const scriptPath = getIngestScriptPath();

      // Wait for Python to finish so the database is ready when this request returns.
      const result = spawnSync(pythonPath, [scriptPath], {
        env: { ...process.env, WORKSPACE_PATH: currentPath, PYTHONUNBUFFERED: '1' },
      });

      if (result.error) {
        console.error('Failed to run Python init:', result.error);
      }
    }

    return res.status(200).json({ success: true, message: 'Workspace finalized successfully.' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Failed to finalize wizard:', e);
    return res.status(500).json({ error: `Finalization failed: ${message}` });
  }
}
