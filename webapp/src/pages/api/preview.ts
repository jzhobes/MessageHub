import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';
import { getInstagramHeaders } from '@/lib/server/instagram';

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

    let title: string | null = null;
    let image: string | null = null;
    let description: string | null = null;

    // Inject Instagram Auth Cookies if available
    let isInstagram = false;
    let isReddit = false;
    try {
      const u = new URL(targetUrl);
      isInstagram = u.hostname.includes('instagram.com');
      isReddit = u.hostname.includes('reddit.com');
    } catch {
      // invalid url
    }

    if (isReddit) {
      // Special handling for Reddit: Fetch .json version to bypass HTML scraping blocks
      try {
        const u = new URL(targetUrl);
        // Append .json to pathname (handling trailing slash)
        u.pathname = u.pathname.replace(/\/$/, '') + '.json';
        const jsonUrl = u.toString();

        console.log(`[Preview] Reddit URL detected. Fetching JSON: ${jsonUrl}`);

        const response = await fetch(jsonUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json();
          // Reddit JSON structure: [ { kind: 't3', data: { ...post... } }, ... ]
          const post = data[0]?.data?.children?.[0]?.data;
          if (post) {
            title = post.title;
            description = post.selftext?.substring(0, 200);
            image = (post.url_overridden_by_dest || post.preview?.images?.[0]?.source?.url)?.replace(/&amp;/g, '&');

            // Fallback for self posts without images
            if (!image && post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default') {
              image = post.thumbnail;
            }

            if (!image) {
              image =
                'https://upload.wikimedia.org/wikipedia/en/thumb/b/bd/Reddit_Logo_Icon.svg/220px-Reddit_Logo_Icon.svg.png';
            }

            console.log(`[Preview] Reddit JSON success: ${title}`);
          }
        }
      } catch (e) {
        console.error('[Preview] Reddit JSON fetch failed, falling back to HTML', e);
      }
    } else {
      if (isInstagram && process.env.INSTAGRAM_AUTH) {
        headers = { ...headers, ...getInstagramHeaders(process.env.INSTAGRAM_AUTH) };
        console.log('[Preview] Using Authenticated Instagram Fetch');
      }

      const response = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(5000) });

      if (response.ok) {
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

        const getMeta = (propName: string) => {
          const p1 = new RegExp(
            `<meta\\s+[^>]*property=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`,
            'i',
          ).exec(html);
          if (p1) {
            return decodeHtmlEntities(p1[1]);
          }
          const p2 = new RegExp(
            `<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*property=["']${propName}["']`,
            'i',
          ).exec(html);
          if (p2) {
            return decodeHtmlEntities(p2[1]);
          }
          const p3 = new RegExp(`<meta\\s+[^>]*name=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i').exec(
            html,
          );
          if (p3) {
            return decodeHtmlEntities(p3[1]);
          }
          const p4 = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*name=["']${propName}["']`, 'i').exec(
            html,
          );
          if (p4) {
            return decodeHtmlEntities(p4[1]);
          }
          return null;
        };

        image = getMeta('og:image') || getMeta('twitter:image');
        title = getMeta('og:title') || getMeta('twitter:title');
        description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');
      } else {
        console.error(`❌ [Preview] url ${targetUrl} returned ${response.status}`);
      }
    }

    console.log(
      `[Preview] LIVE RESULT for ${targetUrl}: title=${title ? 'found' : 'missing'}, image=${image ? 'found' : 'missing'}`,
    );

    const result = {
      url: targetUrl,
      image,
      title,
      description,
    };

    // Write to cache
    const freshCache = await readCache();
    freshCache[targetUrl] = result;
    await writeCache(freshCache);

    return res.status(200).json(result);
  } catch (e) {
    console.error('Preview fetch error:', e);
    return res.status(500).json({ error: 'Internal Error' });
  }
}
