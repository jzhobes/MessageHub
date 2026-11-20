import { IS_DEMO_MODE, withBasePath } from '@/lib/client/env';

let demoMediaManifest: Record<string, string> = {};

/**
 * Populates the static media manifest loaded from `/demo/data.json` so `getMediaUrl` resolves
 * exported media paths synchronously without hitting `/api/media`.
 */
export function setDemoMediaManifest(manifest: Record<string, string>): void {
  demoMediaManifest = manifest || {};
}

/**
 * Resolves a media attachment URI to either the local `/api/media` route or a pre-exported
 * static `/demo/media/...` path in GitHub Pages demo mode.
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
