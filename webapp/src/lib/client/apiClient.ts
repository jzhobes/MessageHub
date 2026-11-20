import { IS_DEMO_MODE } from '@/lib/client/env';

/**
 * Use `globalThis.fetch` locally and keep the demo router out of that bundle. In static Demo Mode,
 * handle API calls through the in-memory `demoRouter`.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!IS_DEMO_MODE) {
    return globalThis.fetch(input, init);
  }

  const { handleDemoFetch } = await import('@/lib/demo/demoRouter');
  return handleDemoFetch(input, init);
}

/**
 * Return a browser Blob URL for a completed demo download. In local mode, return `null` so the
 * caller can download from `/api/studio/generate-dataset`.
 */
export async function resolveDemoDownloadUrl(jobId: string): Promise<string | null> {
  if (!IS_DEMO_MODE) {
    return null;
  }

  const { getDemoJobDownloadUrl } = await import('@/lib/demo/demoRouter');
  return getDemoJobDownloadUrl(jobId);
}
