import fs from 'fs';
import path from 'path';

/**
 * AppConfig serves as the central configuration manager for the application.
 * It handles resolving local data paths across different environments (including WSL).
 */
class AppConfig {
  private _dataPath?: string;

  /**
   * Resolves a raw string path into a validated absolute path.
   * Handles Windows drive-letter mapping (X:\ -> /mnt/x/) for Non-Windows host environments.
   */
  private _resolvePath(targetPath?: string): string {
    let p = targetPath || process.env.DATA_PATH;

    // Fallback if no target or env var is set
    if (!p) {
      return path.resolve(process.cwd(), '../data');
    }

    // Map Windows drive letters to WSL/Linux style paths if needed
    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(p)) {
      const driveLetter = p.charAt(0).toLowerCase();
      p = p.replace(/^[a-zA-Z]:\\/, `/mnt/${driveLetter}/`).replace(/\\/g, '/');
    }

    // Logic to find project root (handle running from inside /webapp or top-level)
    const currentDir = process.cwd();
    const projectRoot = path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;

    const resolved = path.isAbsolute(p) ? p : path.resolve(projectRoot, p);

    if (!fs.existsSync(resolved)) {
      console.warn(`⚠️ Configuration path does not exist: ${resolved}`);
    }

    return resolved;
  }

  /**
   * The absolute path to the data storage folder.
   */
  public get DATA_PATH(): string {
    if (!this._dataPath) {
      this._dataPath = this._resolvePath();
    }
    return this._dataPath;
  }

  /**
   * Dynamically update the data storage path at runtime.
   */
  public set DATA_PATH(newPath: string) {
    this._dataPath = this._resolvePath(newPath);
    process.env.DATA_PATH = this._dataPath;
  }
}

// Export a single instance of the config service as default
const appConfig = new AppConfig();
export default appConfig;
