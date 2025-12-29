import { createReadStream, promises as fs } from 'fs';
import path from 'path';

import appConfig from '@/lib/shared/appConfig';

import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * API Handler to serve media files (images, videos) from the local data directory.
 * Prevents path traversal and handles platform-specific path structures.
 *
 * @param req - Next.js API request containing 'path' and 'platform' query parameters.
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let { path: filePath, platform } = req.query;

  if (!filePath || !platform) {
    return res.status(400).send('Missing path or platform');
  }

  // Normalize to single strings
  filePath = decodeURIComponent(Array.isArray(filePath) ? filePath[0] : filePath);
  platform = Array.isArray(platform) ? platform[0] : platform;

  // Handle external URLs (for Gmail proxies, etc.)
  if (filePath.startsWith('http')) {
    try {
      const response = await fetch(filePath, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return res.status(response.status).send('Failed to fetch external media');
      }

      const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
      const buffer = Buffer.from(await response.arrayBuffer());

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(buffer);
    } catch (e) {
      console.error('Error fetching external media:', e);
      return res.status(500).send('Error fetching external media');
    }
  }

  // SECURITY: Prevent path traversal
  if (filePath.includes('..')) {
    return res.status(400).send('Invalid path');
  }

  const baseDir = appConfig.WORKSPACE_PATH;
  let relativePath = filePath;

  // Platform-specific path adjustments (case-insensitive)
  platform = platform.toLowerCase();
  if (platform === 'facebook') {
    relativePath = path.join(
      'Facebook',
      filePath.startsWith('your_facebook_activity') ? '' : 'your_facebook_activity',
      filePath,
    );
  } else if (platform === 'instagram') {
    relativePath = path.join(
      'Instagram',
      filePath.startsWith('your_instagram_activity') ? '' : 'your_instagram_activity',
      filePath,
    );
  } else if (platform === 'google_chat') {
    // Google Chat paths are usually in Groups or DMs subdirectory
    const groupsPath = path.join('Google Chat/Groups', filePath);
    const dmsPath = path.join('Google Chat/DMs', filePath);

    // First check Groups
    try {
      await fs.access(path.join(baseDir, groupsPath));
      relativePath = groupsPath;
    } catch {
      // Then check DMs
      try {
        await fs.access(path.join(baseDir, dmsPath));
        relativePath = dmsPath;
      } catch {
        // Fallback to original
        relativePath = path.join('Google Chat/Groups', filePath);
      }
    }
  } else if (platform === 'google_voice') {
    // Google Voice paths in DB often start with "Voice/".
    // The directory on disk is usually just "Voice/".
    if (filePath.toLowerCase().startsWith('voice/')) {
      relativePath = filePath;
    } else {
      relativePath = path.join('Voice', filePath);
    }
  } else if (platform === 'google_mail') {
    relativePath = path.join('Mail', filePath);
  }

  // First try the constructed path
  let absolutePath = path.join(baseDir, relativePath);

  // Helper to check if file exists or try common extensions
  const resolvePath = async (p: string) => {
    try {
      await fs.access(p);
      return p;
    } catch {
      // If file doesn't exist exactly, try common extensions (especially for Google Voice)
      const commonExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.mov', '.vcf'];
      for (const ext of commonExtensions) {
        try {
          await fs.access(p + ext);
          return p + ext;
        } catch {
          // continue
        }
      }
      return null;
    }
  };

  const resolved = await resolvePath(absolutePath);
  if (resolved) {
    absolutePath = resolved;
  } else {
    // Try one more time with the "altPath" (raw filePath)
    const fallback = await resolvePath(path.join(baseDir, filePath));
    if (fallback) {
      absolutePath = fallback;
    } else {
      // Both failed, keep the original absolutePath so the 404 block below captures it
    }
  }

  if (!absolutePath.startsWith(baseDir)) {
    return res.status(403).send('Access denied');
  }

  try {
    const stats = await fs.stat(absolutePath);
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
    } else if (ext === '.csv') {
      contentType = 'text/plain';
    } else if (ext === '.txt') {
      contentType = 'text/plain';
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
      disposition = 'attachment';
    }

    const fileName = path.basename(filePath).replace(/^File-/, '');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const stream = createReadStream(absolutePath);
    stream.pipe(res);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('File not found:', absolutePath);
      return res.status(404).send('File not found');
    }
    console.error('Error serving media:', e);
    return res.status(500).send('Internal Error');
  }
}
