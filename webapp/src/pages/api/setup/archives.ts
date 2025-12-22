import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import appConfig from '@/lib/shared/appConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const dataDir = appConfig.WORKSPACE_PATH;

  try {
    await fs.access(dataDir);
    const files = await fs.readdir(dataDir);

    const archives = files.filter(
      (f) => !f.startsWith('.') && (f.endsWith('.zip') || f.endsWith('.tgz') || f.endsWith('.tar.gz')),
    );

    return res.status(200).json({ archives });
  } catch (error) {
    console.error('Failed to list archives:', error);
    // If data dir doesn't exist yet, just return empty
    return res.status(200).json({ archives: [] });
  }
}
