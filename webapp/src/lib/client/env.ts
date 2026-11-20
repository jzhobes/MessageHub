export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * Prefix root-relative asset paths with `NEXT_PUBLIC_BASE_PATH` so they work under a GitHub Pages
 * subpath.
 */
export function withBasePath(assetPath: string): string {
  if (
    !assetPath ||
    assetPath.startsWith('http://') ||
    assetPath.startsWith('https://') ||
    assetPath.startsWith('data:') ||
    assetPath.startsWith('blob:')
  ) {
    return assetPath;
  }

  const normalized = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  if (!BASE_PATH) {
    return normalized;
  }
  const cleanBase = BASE_PATH.endsWith('/') ? BASE_PATH.slice(0, -1) : BASE_PATH;
  if (normalized === cleanBase || normalized.startsWith(`${cleanBase}/`)) {
    return normalized;
  }
  return `${cleanBase}${normalized}`;
}
