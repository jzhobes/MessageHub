import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';
import { getInstagramHeaders } from '../../utils/instagram';

/**
 * Metadata extracted from a URL's OpenGraph tags.
 */
interface PreviewMetadata {
  url: string;
  image: string | null;
  title: string | null;
  description: string | null;
}

const CACHE_FILE = path.join(process.cwd(), 'preview_cache.json');

/**
 * Reads the preview cache from disk.
 * @returns A promise that resolves to the cache object.
 */
async function readCache(): Promise<Record<string, PreviewMetadata>> {
  try {
    // Only try to read if file exists (catch error)
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    // Ignore ENOENT (file not found), log others if strict
  }
  return {};
}

/**
 * Writes the preview cache to disk.
 * @param data - The cache data to write.
 */
async function writeCache(data: Record<string, PreviewMetadata>) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to write preview cache', e);
  }
}

/**
 * API Handler to fetch OpenGraph preview data for a URL.
 * Checks a local JSON cache first before making a network request.
 *
 * @param req - Next.js API request
 * @param res - Next.js API response
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;
  const targetUrl = Array.isArray(url) ? url[0] : url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }

  // Check cache first
  const cache = await readCache();
  if (cache[targetUrl]) {
    console.log(`[Preview] CACHE HIT for ${targetUrl}`);
    return res.status(200).json(cache[targetUrl]);
  }

  console.log(`[Preview] CACHE MISS - Fetching ${targetUrl}`);

  try {
    let headers: Record<string, string> = {};

    // Inject Instagram Auth Cookies if available
    let isInstagram = false;
    try {
      const u = new URL(targetUrl);
      isInstagram = u.hostname.includes('instagram.com');
    } catch {
      // invalid url
    }

    if (isInstagram && process.env.INSTAGRAM_AUTH) {
      const igHeaders = getInstagramHeaders(process.env.INSTAGRAM_AUTH);

      // Merge into existing headers
      headers = { ...headers, ...igHeaders };

      console.log('[Preview] Using Authenticated Instagram Fetch');
    }

    const response = await fetch(targetUrl, {
      headers,
      // Shorter timeout to fail fast if site is slow
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`❌ [Preview] url ${targetUrl} returned ${response.status}`);
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

    // Write to cache (refetch fresh cache in case of race conditions, though simple overwrite is usually fine for local)
    // For simplicity in this context:
    const freshCache = await readCache();
    freshCache[targetUrl] = result;
    await writeCache(freshCache);

    return res.status(200).json(result);
  } catch (e) {
    console.error('Preview fetch error:', e);
    return res.status(500).json({ error: 'Internal Error' });
  }
}
