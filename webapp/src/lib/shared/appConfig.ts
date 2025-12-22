import fs from 'fs';
import path from 'path';

/**
 * AppConfig serves as the central configuration manager for the application.
 * It handles resolving local data paths across different environments (including WSL).
 */
class AppConfig {
  private _workspacePath?: string;

  /**
   * Resolves a raw string path into a validated absolute path.
   * Handles Windows drive-letter mapping (X:\ -> /mnt/x/) for Non-Windows host environments.
   */
  private _resolvePath(targetPath?: string): string {
    // Determine project root first
    const currentDir = process.cwd();
    const projectRoot = path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;

    let p = targetPath || process.env.WORKSPACE_PATH;

    // If no path in process.env, try reading from .env file directly
    // This is critical because process.env won't pick up changes made by the setup wizard without a restart.
    if (!p) {
      try {
        const envPath = path.join(projectRoot, '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = /^WORKSPACE_PATH=(.*)$/m.exec(content);
          if (match && match[1]) {
            p = match[1].trim().replace(/^["']|["']$/g, '');
          }
        }
      } catch (e) {
        console.error('Failed to read .env file during path resolution:', e);
      }
    }

    // Final fallback: default data directory in project root
    if (!p) {
      return path.resolve(projectRoot, 'data');
    }

    // Map Windows drive letters to WSL/Linux style paths if needed
    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(p)) {
      const driveLetter = p.charAt(0).toLowerCase();
      p = p.replace(/^[a-zA-Z]:\\/, `/mnt/${driveLetter}/`).replace(/\\/g, '/');
    }

    const resolved = path.isAbsolute(p) ? p : path.resolve(projectRoot, p);

    if (!fs.existsSync(resolved)) {
      console.warn(`⚠️  Configuration path does not exist: ${resolved}`);
    }

    return resolved;
  }

  /**
   * The absolute path to the workspace storage folder.
   */
  public get WORKSPACE_PATH(): string {
    if (!this._workspacePath) {
      this._workspacePath = this._resolvePath();
    }
    return this._workspacePath;
  }

  /**
   * Dynamically update the workspace storage path at runtime.
   */
  public set WORKSPACE_PATH(newPath: string) {
    this._workspacePath = this._resolvePath(newPath);
    process.env.WORKSPACE_PATH = this._workspacePath;
  }
}

// Export a single instance of the config service as default
const appConfig = new AppConfig();
export default appConfig;
