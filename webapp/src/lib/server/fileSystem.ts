import { readdir, stat } from 'fs/promises';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * FileSystemService manages secure file system access within the application.
 * It enforces path restrictions based on the FILE_SYSTEM_ROOT environment variable.
 */
class FileSystemService {
  private _fileSystemRoot: string;

  constructor() {
    const rawRoot = path.resolve(process.env.FILE_SYSTEM_ROOT || os.homedir());

    if (!fs.existsSync(rawRoot)) {
      const homeDir = os.homedir();
      console.warn(`⚠️  Invalid FILE_SYSTEM_ROOT ("${rawRoot}"). Defaulting to home ("${homeDir}").`);
      this._fileSystemRoot = homeDir;
    } else {
      console.info(`🗂️  File system root set to: ${rawRoot}`);
      this._fileSystemRoot = rawRoot;
    }
  }

  /**
   * Returns the allowed root directory.
   */
  public get FILE_SYSTEM_ROOT(): string {
    return this._fileSystemRoot;
  }

  /**
   * Resolves a requested path and ensures it remains within the allowed root.
   */
  public resolveSafePath(requestedPath?: string): string {
    const resolved = path.resolve(requestedPath || this._fileSystemRoot);

    // Check if the resolved path is within the allowed root
    const rootWithSep = this._fileSystemRoot.endsWith(path.sep)
      ? this._fileSystemRoot
      : this._fileSystemRoot + path.sep;
    const isWithin = resolved === this._fileSystemRoot || resolved.startsWith(rootWithSep);

    if (!isWithin) {
      throw new Error('PERMISSION_DENIED');
    }

    return resolved;
  }

  /**
   * Calculates a safe parent path, returning null if the path is the allowed root.
   */
  public getSafeParent(currentPath: string): string | null {
    const parent = path.dirname(currentPath);
    if (currentPath === this._fileSystemRoot || parent === currentPath) {
      return null;
    }
    return parent;
  }

  /**
   * Lists the contents of a directory with metadata, excluding hidden files.
   */
  public async listContents(dirPath: string) {
    const dirents = await readdir(dirPath, { withFileTypes: true });

    const folders = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({
        name: d.name,
        path: path.join(dirPath, d.name),
        type: 'folder' as const,
      }));

    // Filter for common export formats
    const fileDirents = dirents.filter(
      (d) => d.isFile() && !d.name.startsWith('.') && (d.name.endsWith('.zip') || d.name.endsWith('.json')),
    );

    const files = await Promise.all(
      fileDirents.map(async (d) => {
        const filePath = path.join(dirPath, d.name);
        try {
          const s = await stat(filePath);
          return {
            name: d.name,
            path: filePath,
            type: 'file' as const,
            size: s.size,
          };
        } catch (e) {
          console.error(`Failed to stat ${filePath}:`, e);
          return {
            name: d.name,
            path: filePath,
            type: 'file' as const,
            size: 0,
          };
        }
      }),
    );

    // Sort: folders first, then alphabetical
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    return [...folders, ...files];
  }
}

const fileSystem = new FileSystemService();
export default fileSystem;
