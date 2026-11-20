import fs from 'fs';
import { readdir, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

import { createPathResolver } from './pathValidators';
import { PathMetadata } from '../shared/types';

/**
 * Keep filesystem access inside `ROOT_IMPORT_PATH` or `ROOT_WORKSPACE_PATH`, depending on the
 * operation.
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
   * Resolve the requested path and its symlinks inside the allowed root. If the path doesn't exist
   * yet, validate the nearest ancestor that does.
   *
   * @param mode - The import or workspace boundary to enforce
   * @param requestedPath - The requested path, defaulting to the configured root
   * @returns The canonical absolute path inside the configured root
   */
  public resolveSafePath(mode: 'import' | 'workspace', requestedPath?: string): string {
    return createPathResolver(this.getRoot(mode))(requestedPath);
  }

  /**
   * Return the parent inside the allowed root, or `null` if we're already at the root.
   */
  public getSafeParent(mode: 'import' | 'workspace', currentPath: string): string | null {
    const root = this.resolveSafePath(mode);
    currentPath = this.resolveSafePath(mode, currentPath);
    const parent = path.dirname(currentPath);
    if (currentPath === root || parent === currentPath) {
      return null;
    }
    return parent;
  }

  /**
   * List visible directory entries and their metadata. Filter files by extension when requested and
   * sort folders first, then by name.
   *
   * @param dirPath - The directory to list within the configured root
   * @param extensions - Optional filename extensions to include
   * @param mode - The import or workspace boundary to enforce
   * @returns The directory entries with folders first, sorted by name
   */
  public async listContents(dirPath: string, extensions?: string[], mode: 'import' | 'workspace' = 'import') {
    const resolvePath = createPathResolver(this.getRoot(mode));
    dirPath = resolvePath(dirPath);
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

      // If extensions were supplied, only include matching files.
      if (extensions && extensions.length > 0) {
        return extensions.some((ext) => d.name.toLowerCase().endsWith(ext.toLowerCase()));
      }

      return true;
    });

    const files = await Promise.all(
      fileDirents.map(async (d) => {
        const filePath = path.join(dirPath, d.name);
        try {
          const s = await stat(resolvePath(filePath));
          return {
            name: d.name,
            path: filePath,
            type: 'file' as const,
            size: s.size,
          };
        } catch (e) {
          console.error('Failed to stat %s:', filePath, e);
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
   * Describe the path so the setup UI can tell whether it's an existing workspace or usable for a
   * new one.
   */
  public async getPathMetadata(dirPath: string): Promise<PathMetadata> {
    const resolvePath = createPathResolver(this.getRoot('workspace'));
    dirPath = resolvePath(dirPath);
    let exists = false;
    let isWritable = false;
    let isEmpty = true;
    let isNested = false;
    let isActive = false;
    let isExistingWorkspace = false;

    try {
      await fs.promises.access(dirPath);
      exists = true;

      try {
        const activeWorkspace = process.env.WORKSPACE_PATH || 'data';
        const absoluteActive = resolvePath(activeWorkspace);

        if (dirPath === absoluteActive) {
          isActive = true;
        } else if (dirPath.startsWith(absoluteActive + path.sep)) {
          isNested = true;
        }
      } catch {
        // Still return metadata for a valid requested folder if the active workspace configuration is invalid.
      }

      // Check for existing workspace signature
      try {
        await fs.promises.access(resolvePath(path.join(dirPath, 'messagehub.db')));
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
