import { promises as fs } from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getFacebookCrawlerHeaders } from '@/lib/server/facebook';
import { getInstagramHeaders } from '@/lib/server/instagram';
import appConfig from '@/lib/shared/appConfig';
import { decodeHtmlEntities } from '@/lib/shared/stringUtils';

interface PreviewMetadata {
  url: string;
  image: string | null;
  title: string | null;
  description: string | null;
}

/**
 * Parses HTML content to extract OpenGraph and other metadata.
 */
function parseMetadata(html: string): { title: string | null; image: string | null; description: string | null } {
  const getMeta = (htmlContent: string, propName: string) => {
    const patterns = [
      new RegExp(`<meta\\s+[^>]*property=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*property=["']${propName}["']`, 'i'),
      new RegExp(`<meta\\s+[^>]*name=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*name=["']${propName}["']`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(htmlContent);
      if (match) {
        return decodeHtmlEntities(match[1]);
      }
    }
    return null;
  };

  return {
    title: getMeta(html, 'og:title') || getMeta(html, 'twitter:title'),
    image: getMeta(html, 'og:image') || getMeta(html, 'twitter:image'),
    description:
      getMeta(html, 'og:description') || getMeta(html, 'twitter:description') || getMeta(html, 'description'),
  };
}

/**
 * Detects the platform of a given URL.
 */
function detectPlatform(url: string): { isFacebook: boolean; isInstagram: boolean; isReddit: boolean } {
  try {
    const u = new URL(url);
    return {
      isFacebook: u.hostname.includes('facebook.com') || u.hostname.includes('fb.com'),
      isInstagram: u.hostname.includes('instagram.com'),
      isReddit: u.hostname.includes('reddit.com'),
    };
  } catch {
    return { isFacebook: false, isInstagram: false, isReddit: false };
  }
}

/**
 * Gets the absolute path to the preview cache file within the current workspace.
 */
function getCachePath(): string {
  return path.join(appConfig.WORKSPACE_PATH, 'preview_cache.json');
}

/**
 * Reads the preview cache from disk.
 * @returns A promise that resolves to the cache object.
 */
async function readCache(): Promise<Record<string, PreviewMetadata>> {
  try {
    const cachePath = getCachePath();
    // Only try to read if file exists (catch error)
    const data = await fs.readFile(cachePath, 'utf8');
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
    const cachePath = getCachePath();
    await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
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
    let title: string | null = null;
    let image: string | null = null;
    let description: string | null = null;

    const { isFacebook, isInstagram, isReddit } = detectPlatform(targetUrl);

    // Reddit strategy: fetch JSON
    if (isReddit) {
      try {
        const u = new URL(targetUrl);
        u.pathname = u.pathname.replace(/\/$/, '') + '.json';
        const response = await fetch(u.toString(), { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const json = await response.json();
          const post = Array.isArray(json) ? json[0]?.data?.children[0]?.data : json?.data?.children[0]?.data;
          if (post) {
            title = post.title;
            image = post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : null;
            description = post.selftext;
          }
        }
      } catch (e) {
        console.error('[Preview] Reddit JSON fetch failed', e);
      }
    }

    // HTML fetch strategy (Facebook, Instagram, General)
    if (!title) {
      let headers: Record<string, string> = {};

      if (isFacebook) {
        headers = getFacebookCrawlerHeaders();
        console.log('[Preview] Using Facebook Crawler Headers');
      } else if (isInstagram && process.env.INSTAGRAM_AUTH) {
        headers = getInstagramHeaders(process.env.INSTAGRAM_AUTH);
        console.log('[Preview] Using Authenticated Instagram Fetch');
      }

      const response = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const html = await response.text();
        const meta = parseMetadata(html);
        title = meta.title;
        image = meta.image;
        description = meta.description;

        // Facebook Proxy for Lookaside
        if (isFacebook && image && image.includes('lookaside')) {
          image = `/api/fb-image-proxy?url=${encodeURIComponent(image)}`;
        }
      } else {
        console.error(`❌ [Preview] Fetch failed for ${targetUrl} (${response.status})`);
      }
    }

    console.log(
      `[Preview] Result for ${targetUrl}: title=${title ? 'found' : 'missing'}, image=${image ? 'found' : 'missing'}`,
    );

    const result = {
      url: targetUrl,
      image,
      title,
      description,
    };

    res.status(200).json(result);

    // Update cache in the background. Since res.json() has already been called,
    // these awaits won't delay the response to the client.
    try {
      const freshCache = await readCache();
      freshCache[targetUrl] = result;
      await writeCache(freshCache);
    } catch (e) {
      console.error('[Preview] Deferred cache update failed', e);
    }
  } catch (e) {
    console.error('Preview fetch error:', e);
    return res.status(500).json({ error: 'Internal Error' });
  }
}
