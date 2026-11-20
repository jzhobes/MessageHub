import { execFileSync } from 'child_process';
import fs from 'fs';
import './env'; // Load the environment early so startup checks use the configured values.

import appConfig from '@/lib/shared/appConfig';

import { getInstagramHeaders } from './instagram';

export const INSTAGRAM_AUTH_CHECK_URL = 'https://www.instagram.com/accounts/edit/';

export type InstagramCheckResult = 'valid' | 'invalid' | 'checkpoint' | 'inconclusive' | 'error';

/**
 * Check `WORKSPACE_PATH` at boot. If a WSL path under `/mnt/<drive>/` is missing, try an
 * interactive `sudo mount -t drvfs` and register unmount hooks for `SIGINT` and `SIGTERM`.
 * Check the Instagram session in the background when `INSTAGRAM_AUTH` is set.
 */
export async function runStartupChecks() {
  console.log('🔍 [Instrumentation] Running Startup Checks...');

  // 1. Check Data Directory
  const dataDir = appConfig.WORKSPACE_PATH;

  if (fs.existsSync(dataDir)) {
    console.log(`✅ [Instrumentation] Data Directory Found: ${dataDir}`);
  } else {
    console.warn(`⚠️  [Instrumentation] Data Directory NOT FOUND: ${dataDir}`);

    // Auto-Mount Attempt for WSL
    const wslMatch = dataDir.match(/^\/mnt\/([a-z])\//);
    if (wslMatch) {
      const driveLetter = wslMatch[1];
      const mountPoint = `/mnt/${driveLetter}`;
      console.log(
        `🔄 [Instrumentation] Detected missing WSL mount. Attempting to mount drive ${driveLetter.toUpperCase()}: ...`,
      );
      console.log(`🔑 [Instrumentation] You may be prompted for your sudo password.`);

      try {
        // Try mounting the Windows drive from WSL.
        execFileSync('sudo', ['mkdir', '-p', mountPoint], { stdio: 'inherit' });
        // Mount
        execFileSync('sudo', ['mount', '-t', 'drvfs', `${driveLetter.toUpperCase()}:`, mountPoint], {
          stdio: 'inherit',
        });

        if (fs.existsSync(dataDir)) {
          console.log(`✅ [Instrumentation] Auto-Mount SUCCESS! Drive is ready.`);

          // Register cleanup hook
          const cleanup = () => {
            console.log(`\n🧹 [Instrumentation] Unmounting "${mountPoint}"...`);
            try {
              execFileSync('sudo', ['umount', mountPoint], { stdio: 'inherit' });
              // Remove the mount directory if it's empty.
              execFileSync('sudo', ['rmdir', mountPoint], { stdio: 'inherit' });
              console.log(`✅ Unmounted and removed "${mountPoint}".`);
            } catch (e) {
              console.error(`❌ Failed to unmount/remove:`, e);
            }
            process.exit(0);
          };

          process.on('SIGINT', cleanup);
          process.on('SIGTERM', cleanup);
        } else {
          // If mounting worked but the workspace is still missing, undo the mount.
          console.warn(`⚠️ [Instrumentation] Mount successful but ${dataDir} not found. Unmounting...`);
          execFileSync('sudo', ['umount', mountPoint], { stdio: 'inherit' });
          execFileSync('sudo', ['rmdir', mountPoint], { stdio: 'inherit' });
          throw new Error('Directory still missing after mount.');
        }
      } catch (e) {
        console.error(`❌ [Instrumentation] Auto-Mount FAILED`, e);
        console.error(`   To fix this, run the following command manually (requires sudo):`);
        console.error(`   👉 sudo mount -t drvfs ${driveLetter.toUpperCase()}: ${mountPoint}`);
      }
    } else {
      console.error(`   Please check your setup.`);
    }
  }

  // 2. Check Instagram Credentials
  const igAuth = process.env.INSTAGRAM_AUTH?.trim();
  if (igAuth) {
    // Let the server start while the session check runs.
    void checkInstagram(igAuth);
  } else {
    console.log('ℹ️  [Instrumentation] No INSTAGRAM_AUTH in .env. Skipping Instagram validation.');
  }
}

function extractRedirectPath(rawLocation: string): string {
  if (!rawLocation) {
    return '';
  }
  try {
    return new URL(rawLocation, INSTAGRAM_AUTH_CHECK_URL).pathname;
  } catch {
    return rawLocation;
  }
}

/**
 * Check the Instagram session with a 10-second timeout and `redirect: 'manual'`. Return `valid`,
 * `invalid`, `checkpoint`, `inconclusive`, or `error` instead of throwing.
 */
export async function checkInstagram(authEnv: string): Promise<InstagramCheckResult> {
  const headers = getInstagramHeaders(authEnv);

  try {
    const res = await fetch(INSTAGRAM_AUTH_CHECK_URL, {
      method: 'GET',
      headers: headers as unknown as HeadersInit,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 200) {
      const data = await res.text();
      const isLogin = data.includes('<title>Login') || data.includes('Login • Instagram');

      if (!isLogin) {
        console.log('✅ [Instrumentation] Instagram Credentials appear VALID.');
        return 'valid';
      }

      console.warn('⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Login page returned).');
      return 'invalid';
    }

    await res.body?.cancel().catch(() => {});

    if (res.status >= 300 && res.status < 400) {
      const rawLocation = res.headers.get('location') ?? '';
      const redirectPath = extractRedirectPath(rawLocation);

      if (/\/(challenge|checkpoint)\b/i.test(redirectPath)) {
        console.warn(
          `⚠️  [Instrumentation] Instagram session requires verification/checkpoint (Status: ${res.status}, Redirect: ${redirectPath}).`,
        );
        return 'checkpoint';
      }

      console.warn(
        `⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Status: ${res.status}${redirectPath ? `, Redirect: ${redirectPath}` : ''}).`,
      );
      return 'invalid';
    }

    if (res.status === 401 || res.status === 403) {
      console.warn(`⚠️  [Instrumentation] Instagram Credentials appear INVALID or EXPIRED (Status: ${res.status}).`);
      return 'invalid';
    }

    if (res.status === 429 || res.status >= 500) {
      console.warn(
        `⚠️  [Instrumentation] Instagram credential check inconclusive (Status: ${res.status} - rate-limited or unavailable).`,
      );
      return 'inconclusive';
    }

    console.warn(`⚠️  [Instrumentation] Instagram credential check returned unexpected status (${res.status}).`);
    return 'inconclusive';
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️  [Instrumentation] Failed to connect to Instagram check: ${errorMessage}`);
    return 'error';
  }
}
