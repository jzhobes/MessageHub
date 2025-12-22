import { readdir, stat } from 'fs/promises';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PathMetadata } from '../shared/types';

/**
 * FileSystemService manages secure file system access within the application.
 * It enforces path restrictions based on the FILE_SYSTEM_ROOT environment variable.
 */
class FileSystemService {
  private _importRoot: string;
  private _workspaceRoot: string;

  constructor() {
    this._importRoot = this.resolveRoot(process.env.ROOT_IMPORT_PATH, 'ROOT_IMPORT_PATH');
    this._workspaceRoot = this.resolveRoot(process.env.ROOT_WORKSPACE_PATH, 'ROOT_WORKSPACE_PATH');
  }

  private resolveRoot(envPath: string | undefined, name: string): string {
    const raw = path.resolve(envPath || os.homedir());
    if (!fs.existsSync(raw)) {
      const home = os.homedir();
      console.warn(`⚠️  Invalid ${name} ("${raw}"). Defaulting to home ("${home}").`);
      return home;
    }
    console.info(`🗂️  ${name} set to: ${raw}`);
    return raw;
  }

  public getRoot(mode: 'import' | 'workspace'): string {
    return mode === 'workspace' ? this._workspaceRoot : this._importRoot;
  }

  /**
   * Resolves a requested path and ensures it remains within the allowed root for the given mode.
   */
  public resolveSafePath(mode: 'import' | 'workspace', requestedPath?: string): string {
    const root = this.getRoot(mode);
    const resolved = path.resolve(requestedPath || root);

    // Check if the resolved path is within the allowed root
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    const isWithin = resolved === root || resolved.startsWith(rootWithSep);

    if (!isWithin) {
      throw new Error('PERMISSION_DENIED');
    }

    return resolved;
  }

  /**
   * Calculates a safe parent path, returning null if the path is the allowed root.
   */
  public getSafeParent(mode: 'import' | 'workspace', currentPath: string): string | null {
    const root = this.getRoot(mode);
    const parent = path.dirname(currentPath);
    if (currentPath === root || parent === currentPath) {
      return null;
    }
    return parent;
  }

  /**
   * Lists the contents of a directory with metadata, excluding hidden files.
   * Optionally filters files by extensions.
   */
  public async listContents(dirPath: string, extensions?: string[]) {
    const dirents = await readdir(dirPath, { withFileTypes: true });

    const folders = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({
        name: d.name,
        path: path.join(dirPath, d.name),
        type: 'folder' as const,
      }));

    // Filter files
    const fileDirents = dirents.filter((d) => {
      if (!d.isFile() || d.name.startsWith('.')) {
        return false;
      }

      // If extensions provided, check them
      if (extensions && extensions.length > 0) {
        return extensions.some((ext) => d.name.toLowerCase().endsWith(ext.toLowerCase()));
      }

      return true;
    });

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

  /**
   * Generates intelligence metadata for a path, used for validation and UI feedback.
   */
  public async getPathMetadata(dirPath: string): Promise<PathMetadata> {
    let exists = false;
    let isWritable = false;
    let isEmpty = true;
    let isNested = false;
    let isActive = false;
    let isExistingWorkspace = false;

    try {
      await fs.promises.access(dirPath);
      exists = true;

      const activeWorkspace = process.env.WORKSPACE_PATH || 'data';
      const absoluteActive = path.resolve(activeWorkspace);
      const absoluteCurrent = path.resolve(dirPath);

      if (absoluteCurrent === absoluteActive) {
        isActive = true;
      } else if (absoluteCurrent.startsWith(absoluteActive + path.sep)) {
        isNested = true;
      }

      // Check for existing workspace signature
      try {
        await fs.promises.access(path.join(dirPath, 'messagehub.db'));
        isExistingWorkspace = true;
      } catch {}

      // Check writability
      try {
        await fs.promises.access(dirPath, fs.constants.W_OK);
        isWritable = true;
      } catch {}

      // Check emptiness
      const contents = await fs.promises.readdir(dirPath);
      if (contents.filter((f) => f !== '.DS_Store' && f !== 'thumbs.db').length > 0) {
        isEmpty = false;
      }
    } catch {
      exists = false;
    }

    return {
      exists,
      isWritable,
      isEmpty,
      isNested,
      isActive,
      isExistingWorkspace,
    };
  }
}

const fileSystem = new FileSystemService();
export default fileSystem;
