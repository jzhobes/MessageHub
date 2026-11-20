import { getFacebookCrawlerHeaders } from '@/lib/server/facebook';
import { fetchRemote, isBlockedRemoteUrl } from '@/lib/server/remoteFetch';

import type { NextApiRequest, NextApiResponse } from 'next';

const FACEBOOK_CDN_DOMAINS = ['facebook.com', 'fb.com', 'fbsbx.com', 'fbcdn.net'];

/**
 * Fetch images from allowed Facebook CDN hosts using crawler headers so hotlink and lookaside URLs
 * work.
 * Return 403 for other hosts and 415 for responses outside `image/*`. Cache valid images as
 * immutable.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  const targetUrl = Array.isArray(url) ? url[0] : url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const u = new URL(targetUrl);
    const isAllowed = FACEBOOK_CDN_DOMAINS.some((domain) => u.hostname === domain || u.hostname.endsWith(`.${domain}`));

    if (!isAllowed) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
  } catch (e) {
    console.error('Invalid URL: "%s"', targetUrl, e);
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const headers = getFacebookCrawlerHeaders();

    const { response, readBody } = await fetchRemote(targetUrl, {
      headers,
      allowedHosts: FACEBOOK_CDN_DOMAINS.flatMap((domain) => [domain, `**.${domain}`]),
      timeoutMs: 10000,
      maxResponseBytes: 10 * 1024 * 1024,
    });

    if (!response.ok) {
      await response.body?.cancel();
      return res.status(response.status).send('Failed to fetch image');
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      await response.body?.cancel();
      return res.status(415).send('Unsupported Media Type: Proxy only allows images');
    }

    const buffer = await readBody();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    res.send(buffer);
  } catch (e) {
    if (isBlockedRemoteUrl(e)) {
      return res.status(403).send('URL is not allowed');
    }
    console.error('Proxy Image Error: "%s"', targetUrl, e);
    res.status(500).send('Internal Server Error');
  }
}
