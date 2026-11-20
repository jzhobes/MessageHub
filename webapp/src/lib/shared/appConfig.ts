import fs from 'fs';
import path from 'path';
import { parseEnv } from 'util';

/**
 * Keep workspace configuration in one place and resolve local paths for each environment, including
 * WSL.
 */
class AppConfig {
  private _workspacePath?: string;

  /**
   * Turn the configured workspace path into an absolute path. On non-Windows hosts, map drive
   * letters such as X: to `/mnt/x/`. Request handlers check the filesystem boundaries before
   * setting this value.
   */
  private _resolvePath(targetPath?: string): string {
    // Determine project root first
    const currentDir = process.cwd();
    const projectRoot = path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;

    let p = targetPath || process.env.WORKSPACE_PATH;

    // If process.env has no workspace path, read .env directly.
    // The setup wizard can change .env while the server is running.
    if (!p) {
      try {
        const envPath = path.join(projectRoot, '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          p = parseEnv(content).WORKSPACE_PATH;
        }
      } catch (e) {
        console.error('Failed to read .env file during path resolution:', e);
      }
    }

    // With no configured path, use the project's data directory.
    if (!p) {
      return path.resolve(projectRoot, 'data');
    }

    // Map Windows drive letters to WSL/Linux style paths if needed
    if (process.platform !== 'win32' && /^[a-zA-Z]:\\/.test(p)) {
      const driveLetter = p.charAt(0).toLowerCase();
      p = p.replace(/^[a-zA-Z]:\\/, `/mnt/${driveLetter}/`).replace(/\\/g, '/');
    }

    return path.resolve(projectRoot, p);
  }

  /**
   * Absolute path to the workspace folder.
   */
  public get WORKSPACE_PATH(): string {
    if (!this._workspacePath) {
      this._workspacePath = this._resolvePath();
    }
    return this._workspacePath;
  }

  /**
   * Switch the active workspace without restarting.
   */
  public set WORKSPACE_PATH(newPath: string) {
    this._workspacePath = this._resolvePath(newPath);
    process.env.WORKSPACE_PATH = this._workspacePath;
  }
}

// Share this config instance across imports.
const appConfig = new AppConfig();
export default appConfig;
