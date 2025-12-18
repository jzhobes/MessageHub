import path from 'path';
import fs from 'fs';

let cachedPath: string | undefined;

export function setRuntimeDataPath(newPath: string) {
  process.env.DATA_PATH = newPath;
  cachedPath = undefined;
}

export function getDataDir(): string {
  if (cachedPath) {
    return cachedPath;
  }

  // 2. Try environment variable
  if (process.env.DATA_PATH) {
    let targetPath = process.env.DATA_PATH;

    // If path starts with "X:\" and we are not on Windows, map to /mnt/x/
    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(targetPath)) {
      const driveLetter = targetPath.charAt(0).toLowerCase();
      targetPath = targetPath.replace(/^[a-zA-Z]:\\/, `/mnt/${driveLetter}/`).replace(/\\/g, '/');
    }

    // Determine project root to resolve relative env paths correctly
    const currentDir = process.cwd();
    const projectRoot = path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;

    const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath);

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
