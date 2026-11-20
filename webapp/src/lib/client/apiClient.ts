import { IS_DEMO_MODE } from '@/lib/client/env';

/**
 * Unified API fetch wrapper. Delegates straight to `globalThis.fetch` in normal local mode
 * (tree-shaking out the demo router) and routes to the in-memory `demoRouter` in static Demo Mode.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!IS_DEMO_MODE) {
    return globalThis.fetch(input, init);
  }

  const { handleDemoFetch } = await import('@/lib/demo/demoRouter');
  return handleDemoFetch(input, init);
}

/**
 * Resolves a completed dataset generation download URL: returns an in-browser Blob URL in Demo Mode
 * or `null` in local mode (where the caller downloads directly from `/api/studio/generate-dataset`).
 */
export async function resolveDemoDownloadUrl(jobId: string): Promise<string | null> {
  if (!IS_DEMO_MODE) {
    return null;
  }

  const { getDemoJobDownloadUrl } = await import('@/lib/demo/demoRouter');
  return getDemoJobDownloadUrl(jobId);
}
