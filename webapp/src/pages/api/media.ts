import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';
import appConfig from '@/lib/shared/appConfig';

/**
 * API Handler to serve media files (images, videos) from the local data directory.
 * Prevents path traversal and handles platform-specific path structures.
 *
 * @param req - Next.js API request containing 'path' and 'platform' query parameters.
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path: pathParam, platform } = req.query;

  if (!pathParam || !platform) {
    return res.status(400).send('Missing path or platform');
  }

  const pathStr = decodeURIComponent(Array.isArray(pathParam) ? pathParam[0] : pathParam);

  // SECURITY: Prevent path traversal
  // This is critical since this API reads arbitrary files from disk
  if (pathStr.includes('..')) {
    return res.status(400).send('Invalid path');
  }

  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  if (!pathStr) {
    // Changed from !filePath to !pathStr
    return res.status(400).send('Missing path');
  }

  const baseDir = appConfig.DATA_PATH;
  let relativePath = pathStr;

  // Platform-specific path adjustments
  if (platformStr === 'Facebook') {
    relativePath = path.join(
      'Facebook',
      pathStr.startsWith('your_facebook_activity') ? '' : 'your_facebook_activity',
      pathStr,
    );
  } else if (platformStr === 'Instagram') {
    relativePath = path.join(
      'Instagram',
      pathStr.startsWith('your_instagram_activity') ? '' : 'your_instagram_activity',
      pathStr,
    );
  } else if (platformStr === 'Google Chat') {
    // Google Chat paths are usually in Groups subdirectory
    relativePath = path.join('Google Chat/Groups', pathStr);
  }

  // First try the constructed path
  let absolutePath = path.join(baseDir, relativePath);

  // Fallback: If not found, try the raw path (in case it was already correct or different structure)
  try {
    await fs.access(absolutePath);
  } catch {
    // Original path failed, try valid fallback
    const altPath = path.join(baseDir, pathStr);
    try {
      await fs.access(altPath);
      absolutePath = altPath;
    } catch {
      // Both failed
    }
  }

  if (!absolutePath.startsWith(baseDir)) {
    return res.status(403).send('Access denied');
  }

  try {
    const fileBuffer = await fs.readFile(absolutePath);

    const ext = path.extname(absolutePath).toLowerCase();
    let contentType = 'application/octet-stream';
    let disposition = 'inline';

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
    } else if (ext === '.pdf') {
      contentType = 'application/pdf';
      disposition = 'inline';
    } else if (ext === '.csv') {
      contentType = 'text/plain';
      disposition = 'inline';
    } else if (ext === '.txt') {
      contentType = 'text/plain';
      disposition = 'inline';
    } else if (ext === '.xlsx') {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      disposition = 'attachment';
    } else if (ext === '.docx') {
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      disposition = 'attachment';
    } else if (ext === '.zip') {
      contentType = 'application/zip';
      disposition = 'attachment';
    } else {
      // Fallback for other binary files
      disposition = 'attachment';
    }

    res.setHeader('Content-Type', contentType);
    const fileName = path.basename(pathStr).replace(/^File-/, '');
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(fileBuffer);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('File not found:', absolutePath);
      return res.status(404).send('File not found');
    }
    console.error('Error serving media:', e);
    return res.status(500).send('Internal Error');
  }
}
