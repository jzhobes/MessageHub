import { IS_DEMO_MODE, withBasePath } from '@/lib/client/env';

let demoMediaManifest: Record<string, string> = {};

/**
 * Register the manifest from `/demo/data.json` so `getMediaUrl` can look up exported files without
 * calling `/api/media`.
 */
export function setDemoMediaManifest(manifest: Record<string, string>): void {
  demoMediaManifest = manifest || {};
}

/**
 * Point attachments to `/api/media` locally or the exported `/demo/media/...` file on GitHub Pages.
 */
export function getMediaUrl(uri: string, platform: string): string {
  if (!uri) {
    return '';
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return IS_DEMO_MODE ? uri : `/api/media?path=${encodeURIComponent(uri)}&platform=${encodeURIComponent(platform)}`;
  }

  if (!IS_DEMO_MODE) {
    return `/api/media?path=${encodeURIComponent(uri)}&platform=${encodeURIComponent(platform)}`;
  }

  const normPlatform = platform.toLowerCase();
  const trimmedUri = uri.replace(/^\/+/, '');
  const mapped = demoMediaManifest[`${normPlatform}::${uri}`] || demoMediaManifest[`${normPlatform}::${trimmedUri}`];

  if (mapped) {
    return withBasePath(mapped);
  }

  return withBasePath(`/demo/media/${normPlatform}/${trimmedUri}`);
}
