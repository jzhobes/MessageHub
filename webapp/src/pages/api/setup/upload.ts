import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { getDataDir } from '@/lib/shared/config';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const dataDir = getDataDir();

  // Ensure data dir exists
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
  } catch (e: any) {
    // If it fails with EEXIST, that's fine (race condition safety).
    // If other error, we fail.
    if (e.code !== 'EEXIST') {
      return res.status(500).json({ error: 'Failed to create data directory' });
    }
  }

  const form = formidable({
    uploadDir: dataDir,
    maxFileSize: 100 * 1024 * 1024 * 1024, // 100GB
    maxTotalFileSize: 100 * 1024 * 1024 * 1024, // 100GB
    keepExtensions: true,
    filename: (_name, _ext, part, _form) => {
      // Use original filename if available, else generic
      return part.originalFilename || `upload_${Date.now()}.zip`;
    },
    filter: (part) => {
      // Basic filter for zip? Or let user upload anything?
      // User said "pick zip files".
      // Sometimes exports are .json or folders (folders can't be uploaded easily).
      // Let's iterate. Just return true.
      return true;
    },
  });

  try {
    const [fields, files] = await form.parse(req);
    return res.status(200).json({ success: true, count: Object.keys(files).length });
  } catch (e: any) {
    console.error('Upload error', e);
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
}
