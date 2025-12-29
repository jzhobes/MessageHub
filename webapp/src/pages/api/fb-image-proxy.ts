import { getFacebookCrawlerHeaders } from '@/lib/server/facebook';

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  const targetUrl = Array.isArray(url) ? url[0] : url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const u = new URL(targetUrl);
    const allowedDomains = ['facebook.com', 'fb.com', 'fbsbx.com', 'fbcdn.net'];
    const isAllowed = allowedDomains.some((domain) => u.hostname === domain || u.hostname.endsWith(`.${domain}`));

    if (!isAllowed) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
  } catch (e) {
    console.error(`Invalid URL: "${targetUrl}"`, e);
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const headers = getFacebookCrawlerHeaders();

    const response = await fetch(targetUrl, { headers });

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch image');
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(415).send('Unsupported Media Type: Proxy only allows images');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Pipe the response body to the client
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (e) {
    console.error(`Proxy Image Error: "${targetUrl}"`, e);
    res.status(500).send('Internal Server Error');
  }
}
