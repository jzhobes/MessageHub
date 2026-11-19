import fs from 'fs';
import path from 'path';

/**
 * Resolves symlinks in the existing part of a path, preserving missing child components.
 * Rejects dangling symlinks and filesystem errors other than missing paths.
 *
 * @param targetPath - The path to canonicalize
 * @returns The canonical absolute path, including any missing suffix
 */
export function canonicalizePath(targetPath: string): string {
  let current = path.resolve(targetPath);
  const missing: string[] = [];

  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
      // realpath also reports ENOENT for a dangling symlink. Never treat it as a new directory.
      try {
        fs.lstatSync(current);
        throw new Error('PERMISSION_DENIED');
      } catch (statError) {
        if (!(statError && typeof statError === 'object' && 'code' in statError && statError.code === 'ENOENT')) {
          throw statError;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error('PERMISSION_DENIED');
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Checks containment using complete path components rather than a string prefix.
 *
 * @param root - The absolute root directory
 * @param target - The absolute path to check
 * @returns Whether the target is the root or one of its descendants
 */
export function isPathWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
