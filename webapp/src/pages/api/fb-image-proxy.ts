import type { NextApiRequest, NextApiResponse } from 'next';

import { getFacebookCrawlerHeaders } from '@/lib/server/facebook';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  const targetUrl = Array.isArray(url) ? url[0] : url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const u = new URL(targetUrl);
    const allowed =
      u.hostname.includes('facebook.com') ||
      u.hostname.includes('fb.com') ||
      u.hostname.includes('fbsbx.com') ||
      u.hostname.includes('fbcdn.net');
    if (!allowed) {
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
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Pipe the response body to the client
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (e) {
    console.error(`Proxy Image Error: "${targetUrl}"`, e);
    res.status(500).send('Internal Server Error');
  }
}
