import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '../../utils/config';

/**
 * API Handler to list message threads for a specific platform.
 * Reads from the pre-generated index JSON files.
 *
 * @param req - Next.js API request containing 'platform' query parameter.
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform } = req.query;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  const dataDir = getDataDir();
  let indexPath;

  if (platformStr === 'Facebook') {
    indexPath = path.join(dataDir, 'fb_threads_index.json');
  } else if (platformStr === 'Instagram') {
    indexPath = path.join(dataDir, 'ig_threads_index.json');
  } else if (platformStr === 'Google Chat') {
    indexPath = path.join(dataDir, 'google_chat_threads_index.json');
  } else {
    return res.status(200).json([]);
  }

  try {
    // Attempt read directly, will throw ENOENT if missing
    const fileContents = await fs.readFile(indexPath, 'utf8');
    const data = JSON.parse(fileContents);

    // Data is already fixed by Python script
    return res.status(200).json(data);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return res.status(200).json([]);
    }
    console.error('Error reading index:', e);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
}
