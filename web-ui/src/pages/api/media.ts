import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path: filePathParam } = req.query;
  const filePath = Array.isArray(filePathParam) ? filePathParam[0] : filePathParam;

  if (!filePath) return res.status(400).send('Missing path');

  const baseDir = path.resolve(process.cwd(), '../data');
  const absolutePath = path.join(baseDir, filePath);

  if (!absolutePath.startsWith(baseDir)) {
    return res.status(403).send('Access denied');
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send('File not found');
  }

  try {
    const fileBuffer = fs.readFileSync(absolutePath);

    const ext = path.extname(absolutePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.gif') {
      contentType = 'image/gif';
    } else if (ext === '.mp4') {
      contentType = 'video/mp4';
    } else if (ext === '.mov') {
      contentType = 'video/quicktime';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error serving media:', error);
    return res.status(500).send('Internal Error');
  }
}
