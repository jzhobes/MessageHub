import { guardedFetch, GuardedFetchError, isGuardedFetchError } from 'guarded-fetch';

import type { GuardedFetchOptions } from 'guarded-fetch';

interface RemoteFetchOptions extends Pick<GuardedFetchOptions, 'headers' | 'allowedHosts' | 'allowedCookie'> {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/**
 * Check whether the URL safety policy rejected a remote request.
 *
 * @param error - The error thrown by the remote request
 * @returns Whether the URL was invalid or blocked
 */
export function isBlockedRemoteUrl(error: unknown): boolean {
  return (
    isGuardedFetchError(error) &&
    ['invalid_url', 'protocol_not_allowed', 'host_not_allowed', 'hostname_unsafe', 'redirect_to_unsafe_host'].includes(
      error.code,
    )
  );
}

/**
 * Fetch a public HTTP or HTTPS URL with SSRF protection. DNS, redirects, and body reads share one
 * deadline. `readBody` also caps the number of bytes it buffers.
 *
 * @param url - The remote URL to fetch
 * @param options - Request headers, allowed hosts, cookies, and response limits
 * @returns The upstream response and a function to read its body as a bounded buffer
 */
export async function fetchRemote(url: string, options: RemoteFetchOptions = {}) {
  const { timeoutMs = 5000, maxResponseBytes = 2 * 1024 * 1024, ...fetchOptions } = options;
  const deadlineAt = Date.now() + timeoutMs;
  const response = await guardedFetch(url, {
    ...fetchOptions,
    timeoutMs,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const readBody = async (): Promise<Buffer> => {
    if (!response.body) {
      return Buffer.alloc(0);
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new GuardedFetchError('timeout', 'Remote response timed out')),
        Math.max(0, deadlineAt - Date.now()),
      );
    });

    try {
      while (true) {
        if (Date.now() >= deadlineAt) {
          throw new GuardedFetchError('timeout', 'Remote response timed out');
        }
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) {
          break;
        }
        received += value.byteLength;
        if (received > maxResponseBytes) {
          throw new GuardedFetchError('response_too_large', 'Remote response exceeded the size limit');
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, received);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  };

  return { response, readBody };
}
