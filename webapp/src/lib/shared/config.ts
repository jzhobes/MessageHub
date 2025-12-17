import path from 'path';
import fs from 'fs';

let cachedPath: string | undefined;

export function getDataDir(): string {
  if (cachedPath) {
    return cachedPath;
  }

  // Try environment variable
  if (process.env.DATA_PATH) {
    let targetPath = process.env.DATA_PATH;

    // If path starts with "X:\" and we are not on Windows, map to /mnt/x/
    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(targetPath)) {
      const driveLetter = targetPath.charAt(0).toLowerCase();
      targetPath = targetPath.replace(/^[a-zA-Z]:\\/, `/mnt/${driveLetter}/`).replace(/\\/g, '/');
    }

    const resolved = path.resolve(process.cwd(), targetPath);

    if (!fs.existsSync(resolved)) {
      console.error(`⚠️ Configured DATA_PATH does not exist: ${resolved}`);
    }

    cachedPath = resolved;

    return resolved;
  }

  // Fallback to default
  const defaultPath = path.resolve(process.cwd(), '../data');
  cachedPath = defaultPath;
  return defaultPath;
}
