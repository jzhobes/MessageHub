import { createReadStream, promises as fs } from 'fs';
import path from 'path';

import { createPathResolver, hasErrorCode } from '@/lib/server/pathValidators';
import { fetchRemote, isBlockedRemoteUrl } from '@/lib/server/remoteFetch';
import appConfig from '@/lib/shared/appConfig';

import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    // Media often goes over Next.js's default 4 MB warning threshold.
    responseLimit: false,
  },
};

/**
 * Serve media from the local workspace. Resolve platform-specific paths and keep file access inside
 * the workspace.
 *
 * @param req - Next.js API request containing 'path' and 'platform' query parameters.
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let { path: filePath, platform } = req.query;

  if (!filePath || !platform) {
    return res.status(400).send('Missing path or platform');
  }

  // Read one value per query parameter.
  try {
    filePath = decodeURIComponent(Array.isArray(filePath) ? filePath[0] : filePath);
  } catch {
    return res.status(400).send('Invalid path');
  }
  platform = Array.isArray(platform) ? platform[0] : platform;

  // Some attachments point to external URLs, such as Gmail proxies.
  if (filePath.startsWith('http')) {
    try {
      const { response, readBody } = await fetchRemote(filePath, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeoutMs: 30000,
        maxResponseBytes: 50 * 1024 * 1024,
      });

      if (!response.ok) {
        await response.body?.cancel();
        return res.status(response.status).send('Failed to fetch external media');
      }

      const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
      const buffer = await readBody();

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(buffer);
    } catch (e) {
      if (isBlockedRemoteUrl(e)) {
        return res.status(403).send('URL is not allowed');
      }
      console.error('Error fetching external media:', e);
      return res.status(500).send('Error fetching external media');
    }
  }

  // Keep resolved paths inside the workspace to prevent path traversal.
  if (filePath.includes('..')) {
    return res.status(400).send('Invalid path');
  }

  try {
    const baseDir = appConfig.WORKSPACE_PATH;
    const resolveWorkspacePath = createPathResolver(baseDir);
    const candidates: string[] = [];
    platform = platform.toLowerCase();
    if (platform === 'facebook') {
      candidates.push(
        path.join('Facebook', filePath.startsWith('your_facebook_activity') ? '' : 'your_facebook_activity', filePath),
      );
    } else if (platform === 'instagram') {
      candidates.push(
        path.join(
          'Instagram',
          filePath.startsWith('your_instagram_activity') ? '' : 'your_instagram_activity',
          filePath,
        ),
      );
    } else if (platform === 'google_chat') {
      candidates.push(path.join('Google Chat/Groups', filePath), path.join('Google Chat/DMs', filePath));
    } else if (platform === 'google_voice') {
      candidates.push(filePath.toLowerCase().startsWith('voice/') ? filePath : path.join('Voice', filePath));
    } else if (platform === 'google_mail') {
      candidates.push(path.join('Mail', filePath));
    }
    candidates.push(filePath);
    let absolutePath: string | undefined;
    const extensions = ['', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.mov', '.vcf'];
    for (const candidate of new Set(candidates)) {
      for (const extension of extensions) {
        const safePath = resolveWorkspacePath(path.join(baseDir, candidate + extension));
        try {
          await fs.access(safePath);
          absolutePath = safePath;
          break;
        } catch (error) {
          if (!hasErrorCode(error, 'ENOENT') && !hasErrorCode(error, 'ENOTDIR')) {
            throw error;
          }
        }
      }
      if (absolutePath) {
        break;
      }
    }
    if (!absolutePath) {
      return res.status(404).send('File not found');
    }

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
    if (e instanceof Error && e.message === 'PERMISSION_DENIED') {
      return res.status(403).send('Access denied');
    }
    if (hasErrorCode(e, 'ENOENT')) {
      return res.status(404).send('File not found');
    }
    console.error('Error serving media:', e);
    return res.status(500).send('Internal Error');
  }
}
