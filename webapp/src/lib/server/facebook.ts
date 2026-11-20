/**
 * Use Facebook's crawler headers to fetch OpenGraph metadata or images served only to the crawler.
 */
export function getFacebookCrawlerHeaders(): Record<string, string> {
  return {
    'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    Referer: 'https://www.facebook.com/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}
