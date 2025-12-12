import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '../../utils/config';

/**
 * API Handler to check the status of processed data availability.
 * Returns boolean flags indicating if thread index files exist for each platform.
 *
 * @param req - Next.js API request
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const dataDir = getDataDir();

  const check = async (filename: string) => {
    try {
      await fs.access(path.join(dataDir, filename));
      return true;
    } catch {
      return false;
    }
  };

  // Check for the existence of the generated JSON index files
  const [facebook, instagram, googleChat] = await Promise.all([check('fb_threads_index.json'), check('ig_threads_index.json'), check('google_chat_threads_index.json')]);

  const status = {
    Facebook: facebook,
    Instagram: instagram,
    'Google Chat': googleChat,
    'Google Voice': false, // placeholder/unimplemented
  };

  res.status(200).json(status);
}
