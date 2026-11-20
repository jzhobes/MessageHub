/**
 * Send browser-style headers for authenticated Instagram requests.
 * Read `authEnv` as a JSON cookie map when possible. If parsing fails, send it as the raw `Cookie`
 * header.
 */
export function getInstagramHeaders(authEnv: string): Record<string, string> {
  let cookieString = authEnv;

  try {
    // Only try JSON if the value looks like an object.
    if (authEnv.trim().startsWith('{')) {
      const authData = JSON.parse(authEnv);
      cookieString = Object.entries(authData)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
  } catch {
    console.warn('Warning: Failed to parse INSTAGRAM_AUTH as JSON, treating as raw string.');
  }

  return {
    Cookie: cookieString,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}
