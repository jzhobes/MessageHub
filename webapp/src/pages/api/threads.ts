import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../../utils/config';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
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
    if (!fs.existsSync(indexPath)) {
      return res.status(200).json([]);
    }
    const fileContents = fs.readFileSync(indexPath, 'utf8');
    const data = JSON.parse(fileContents);

    // Data is already fixed by Python script
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error reading index:', error);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
}
