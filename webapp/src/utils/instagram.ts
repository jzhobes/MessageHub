export function getInstagramHeaders(authEnv: string): Record<string, string> {
  let cookieString = authEnv;

  try {
    // Try parsing JSON first if it looks like JSON
    if (authEnv.trim().startsWith('{')) {
      const authData = JSON.parse(authEnv);
      cookieString = Object.entries(authData)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
  } catch {
    // Ignore, assume string
    console.warn('Warning: Failed to parse INSTAGRAM_AUTH as JSON, treating as raw string.');
  }

  return {
    // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    // 'User-Agent': 'MessageHub',
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
