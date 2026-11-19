import fs from 'fs';
import path from 'path';

/**
 * Resolves symlinks in the existing part of a path, preserving missing child components.
 * Rejects dangling symlinks and filesystem errors other than missing paths.
 * Checks every candidate against the trusted root before filesystem probes.
 *
 * @param targetPath - The path to canonicalize
 * @param rootPath - The trusted absolute root that bounds ancestor traversal
 * @returns The canonical absolute path, including any missing suffix
 */
export function canonicalizePath(targetPath: string, rootPath: string): string {
  const root = path.resolve(rootPath);
  let current = path.resolve(targetPath);
  const missing: string[] = [];

  while (true) {
    const relative = path.relative(root, current);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('PERMISSION_DENIED');
    }
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
      if (current === root) {
        throw new Error('PERMISSION_DENIED');
      }
      // realpath also reports ENOENT for a dangling symlink. Never treat it as a new directory.
      try {
        fs.lstatSync(current);
      } catch (statError) {
        if (!hasErrorCode(statError, 'ENOENT')) {
          throw statError;
        }
        missing.unshift(path.basename(current));
        current = path.dirname(current);
        continue;
      }
      throw new Error('PERMISSION_DENIED');
    }
  }
}

/**
 * Tests an unknown filesystem error for a specific errno code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

/**
 * Creates a path resolver with a canonical root scoped to one filesystem operation.
 * Checks lexical and canonical containment while allowing missing child directories.
 *
 * @param rootPath - The trusted root for this operation
 * @returns A resolver that returns canonical paths within the root
 */
export function createPathResolver(rootPath: string): (requestedPath?: string) => string {
  const root = path.resolve(rootPath);
  const canonicalRoot = fs.realpathSync(root);
  return (requestedPath?: string): string => {
    if (requestedPath !== undefined && (typeof requestedPath !== 'string' || requestedPath.includes('\0'))) {
      throw new Error('PERMISSION_DENIED');
    }
    const resolved = path.resolve(requestedPath || root);
    let traversalRoot = root;
    // Keep guards beside the paths they validate for static analysis.
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      const canonicalRelative = path.relative(canonicalRoot, resolved);
      if (
        canonicalRelative === '..' ||
        canonicalRelative.startsWith('..' + path.sep) ||
        path.isAbsolute(canonicalRelative)
      ) {
        throw new Error('PERMISSION_DENIED');
      }
      traversalRoot = canonicalRoot;
    }
    const canonical = canonicalizePath(resolved, traversalRoot);
    const canonicalRelative = path.relative(canonicalRoot, canonical);
    if (
      canonicalRelative === '..' ||
      canonicalRelative.startsWith('..' + path.sep) ||
      path.isAbsolute(canonicalRelative)
    ) {
      throw new Error('PERMISSION_DENIED');
    }
    return canonical;
  };
}
