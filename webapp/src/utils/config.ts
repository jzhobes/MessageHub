import path from 'path';
import fs from 'fs';

export function getDataDir(): string {
  // 1. Try environment variable
  if (process.env.DATA_PATH) {
    let targetPath = process.env.DATA_PATH;

    // Fix: Handle Windows paths (D:\...) while running on WSL/Linux
    // If path starts with "X:\" and we are not on Windows, map to /mnt/x/
    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(targetPath)) {
      const driveLetter = targetPath.charAt(0).toLowerCase();
      // Replace "D:\" with "/mnt/d/" and switch backslashes to slashes
      targetPath = targetPath.replace(/^[a-zA-Z]:\\/, `/mnt/${driveLetter}/`).replace(/\\/g, '/');
    }

    const resolved = path.resolve(process.cwd(), targetPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }

    // Store failed path for logging in instrumentation
    return resolved;
  }

  // 2. Fallback to default
  return path.resolve(process.cwd(), '../data');
}
