import fs from 'fs';
import { execSync } from 'child_process';
import { getInstagramHeaders } from './instagram';
import { getDataDir } from '@/lib/shared/config';

export async function runStartupChecks() {
  console.log('🔍 [Instrumentation] Running Startup Checks...');

  // 1. Check Data Directory
  const dataDir = getDataDir();

  if (fs.existsSync(dataDir)) {
    console.log(`✅ [Instrumentation] Data Directory Found: ${dataDir}`);
  } else {
    console.warn(`⚠️  [Instrumentation] Data Directory NOT FOUND: ${dataDir}`);

    // Auto-Mount Attempt for WSL
    const wslMatch = dataDir.match(/\/mnt\/([a-z])\//);
    if (wslMatch) {
      const driveLetter = wslMatch[1];
      const mountPoint = `/mnt/${driveLetter}`;
      console.log(`🔄 [Instrumentation] Detected missing WSL mount. Attempting to mount drive ${driveLetter.toUpperCase()}: ...`);
      console.log(`🔑 [Instrumentation] You may be prompted for your sudo password.`);

      try {
        // Create dir just in case
        execSync(`sudo mkdir -p ${mountPoint}`, { stdio: 'inherit' });
        // Mount
        execSync(`sudo mount -t drvfs ${driveLetter.toUpperCase()}: ${mountPoint}`, { stdio: 'inherit' });

        if (fs.existsSync(dataDir)) {
          console.log(`✅ [Instrumentation] Auto-Mount SUCCESS! Drive is ready.`);

          // Register cleanup hook
          const cleanup = () => {
            console.log(`\n🧹 [Instrumentation] Unmounting ${mountPoint}...`);
            try {
              execSync(`sudo umount ${mountPoint}`, { stdio: 'inherit' });
              // Try to remove the empty dir to keep things clean
              execSync(`sudo rmdir ${mountPoint}`, { stdio: 'inherit' });
              console.log(`✅ Unmounted and removed ${mountPoint}.`);
            } catch (e) {
              console.error(`❌ Failed to unmount/remove:`, e);
            }
            process.exit(0);
          };

          process.on('SIGINT', cleanup);
          process.on('SIGTERM', cleanup);
        } else {
          // Mount succeeded but data dir still not found? Bad mount. Cleanup.
          console.warn(`⚠️ [Instrumentation] Mount successful but ${dataDir} not found. Unmounting...`);
          execSync(`sudo umount ${mountPoint}`, { stdio: 'inherit' });
          execSync(`sudo rmdir ${mountPoint}`, { stdio: 'inherit' });
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
  const igAuth = process.env.INSTAGRAM_AUTH;
  if (igAuth) {
    // Don't await to avoid blocking server start
    checkInstagram(igAuth);
  } else {
    console.log('ℹ️  [Instrumentation] No INSTAGRAM_AUTH in .env. Skipping Instagram validation.');
  }
}

async function checkInstagram(authEnv: string) {
  const headers = getInstagramHeaders(authEnv);

  try {
    const res = await fetch('https://www.instagram.com/', {
      method: 'GET',
      headers: headers as unknown as HeadersInit,
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.text();
    const isLogin = data.includes('<title>Login') || data.includes('Login • Instagram');

    if (res.status === 200 && !isLogin) {
      console.log('✅ [Instrumentation] Instagram Credentials appear VALID.');
    } else {
      console.warn(`⚠️  [Instrumentation] Instagram Credentials might be INVALID or EXPIRED (Status: ${res.status}).`);
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️  [Instrumentation] Failed to connect to Instagram check: ${errorMessage}`);
  }
}
