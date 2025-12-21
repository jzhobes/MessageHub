import type { NextApiRequest, NextApiResponse } from 'next';
import { spawnSync } from 'child_process';
import db from '@/lib/server/db';
import { getPythonPath, getIngestScriptPath } from '@/lib/server/python';
import appConfig from '@/lib/shared/appConfig';

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
    // 1. Close current DB connection so Python can safely "touch" the file
    db.close();

    // 2. Ensure DB file exists (using Python as source of truth for schema)
    if (!db.exists()) {
      const pythonPath = await getPythonPath();
      const scriptPath = getIngestScriptPath();

      // Use spawnSync here because finalize needs to be done before we return
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
