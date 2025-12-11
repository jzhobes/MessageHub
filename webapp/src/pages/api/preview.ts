import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

interface PreviewMetadata {
  url: string;
  image: string | null;
  title: string | null;
  description: string | null;
}

const CACHE_FILE = path.join(process.cwd(), '../data/preview_cache.json');

// Helper to read cache safely
function readCache(): Record<string, PreviewMetadata> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read preview cache', e);
  }
  return {};
}

// Helper to write cache safely
function writeCache(data: Record<string, PreviewMetadata>) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to write preview cache', e);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  const targetUrl = Array.isArray(url) ? url[0] : url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }

  // 1. Check Cache
  const cache = readCache();
  if (cache[targetUrl]) {
    console.log(`[Preview] CACHE HIT for ${targetUrl}`);
    return res.status(200).json(cache[targetUrl]);
  }

  console.log(`[Preview] CACHE MISS - Fetching ${targetUrl}`);

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    };

    // Inject Instagram Auth Cookies if available
    if (targetUrl.includes('instagram.com') && process.env.INSTAGRAM_AUTH) {
      try {
        const authData = JSON.parse(process.env.INSTAGRAM_AUTH);
        let cookieString = '';

        // Handle object format (e.g. {x: 'y'})
        cookieString = Object.entries(authData)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');

        if (cookieString) {
          headers['Cookie'] = cookieString;
          // Add helpful headers for scraping
          headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
          headers['Accept-Language'] = 'en-US,en;q=0.5';
          headers['Sec-Fetch-Dest'] = 'document';
          headers['Sec-Fetch-Mode'] = 'navigate';
          headers['Sec-Fetch-Site'] = 'same-origin';
          headers['Sec-Fetch-User'] = '?1';
          headers['Upgrade-Insecure-Requests'] = '1';
          console.log('[Preview] Using Authenticated Instagram Fetch');
        }
      } catch (e) {
        console.error('[Preview] Failed to parse INSTAGRAM_AUTH cookies', e);
      }
    }

    let response = await fetch(targetUrl, {
      headers,
      // Shorter timeout to fail fast if site is slow
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 403 || response.status === 401) {
      console.log(`[Preview] ${response.status} with scraper UA, retrying with Browser UA...`);
      response = await fetch(targetUrl, {
        headers: {
          ...headers,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(5000),
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch' });
    }

    const html = await response.text();

    const decodeHtmlEntities = (str: string) => {
      return str
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&apos;/g, "'");
    };

    // Isolate helper
    const getMeta = (propName: string) => {
      // Try property first
      const p1 = new RegExp(`<meta\\s+[^>]*property=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i').exec(html);
      if (p1) {
        return decodeHtmlEntities(p1[1]);
      }

      // Try content first
      const p2 = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*property=["']${propName}["']`, 'i').exec(html);
      if (p2) {
        return decodeHtmlEntities(p2[1]);
      }

      // Try name attribute
      const p3 = new RegExp(`<meta\\s+[^>]*name=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i').exec(html);
      if (p3) {
        return decodeHtmlEntities(p3[1]);
      }

      const p4 = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*name=["']${propName}["']`, 'i').exec(html);
      if (p4) {
        return decodeHtmlEntities(p4[1]);
      }

      return null;
    };

    const image = getMeta('og:image') || getMeta('twitter:image');
    const title = getMeta('og:title') || getMeta('twitter:title');
    const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');

    console.log(`[Preview] LIVE RESULT for ${targetUrl}: title=${title ? 'found' : 'missing'}, image=${image ? 'found' : 'missing'}`);

    const result = {
      url: targetUrl,
      image,
      title,
      description,
    };

    // 2. Write to Cache (refetch fresh cache in case of race conditions, though simple overwrite is usually fine for local)
    // For simplicity in this context:
    const freshCache = readCache();
    freshCache[targetUrl] = result;
    writeCache(freshCache);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Preview fetch error:', error);
    return res.status(500).json({ error: 'Internal Error' });
  }
}
