import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../../utils/config';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const dataDir = getDataDir();

  // Check for the existence of the generated JSON index files
  const status = {
    Facebook: fs.existsSync(path.join(dataDir, 'fb_threads_index.json')),
    Instagram: fs.existsSync(path.join(dataDir, 'ig_threads_index.json')),
    'Google Chat': fs.existsSync(path.join(dataDir, 'google_chat_threads_index.json')),
    'Google Voice': false, // placeholder/unimplemented
  };

  res.status(200).json(status);
}
