/**
 * Gets the headers required to mimic the Facebook Crawler.
 * This is useful for fetching OpenGraph metadata or images that are gated behind Crawler-only views.
 */
export function getFacebookCrawlerHeaders(): Record<string, string> {
  return {
    'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    Referer: 'https://www.facebook.com/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}
