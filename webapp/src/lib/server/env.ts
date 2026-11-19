import fs from 'fs';
import os from 'os';
import path from 'path';

import { getProjectRoot } from './python';

/**
 * Quotes a workspace path as a single .env value.
 * Rejects control characters and variable expressions interpreted by the Next.js loader.
 *
 * @param workspacePath - The path to persist
 * @returns A quoted value that preserves the original path
 */
export function serializeWorkspacePath(workspacePath: string): string {
  if (/[\r\n\0]|\$(?:\w|\{)|\\\$/.test(workspacePath)) {
    throw new Error('Invalid workspace path');
  }
  const quote = ["'", '`', '"'].find(
    (candidate) => !workspacePath.includes(candidate) && (candidate !== '"' || !/\\[nr]/.test(workspacePath)),
  );
  if (!quote) {
    throw new Error('Workspace path cannot be represented in .env');
  }
  return `${quote}${workspacePath}${quote}`;
}

/**
 * Updates the .env file with the provided workspace path.
 * This ensures the configuration persists across application restarts.
 * Also initializes root boundaries if they are missing.
 */
export async function persistWorkspacePath(workspacePath: string): Promise<void> {
  const value = serializeWorkspacePath(workspacePath);
  const projectRoot = getProjectRoot();
  const envPath = path.resolve(projectRoot, '.env');

  let content = '';
  try {
    await fs.promises.access(envPath);
    content = await fs.promises.readFile(envPath, 'utf-8');
  } catch {
    // .env doesn't exist, start empty
  }

  let newContent = content;

  // 1. Update/Add WORKSPACE_PATH
  if (/^WORKSPACE_PATH=/m.test(newContent)) {
    newContent = newContent.replace(/^WORKSPACE_PATH=.*$/m, () => `WORKSPACE_PATH=${value}`);
  } else {
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `WORKSPACE_PATH=${value}\n`;
  }

  // 2. Ensure Security Roots exist (default to HOME)
  const homeDir = os.homedir();
  if (!/^ROOT_IMPORT_PATH=/m.test(newContent)) {
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `ROOT_IMPORT_PATH=${serializeWorkspacePath(homeDir)}\n`;
  }
  if (!/^ROOT_WORKSPACE_PATH=/m.test(newContent)) {
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `ROOT_WORKSPACE_PATH=${serializeWorkspacePath(homeDir)}\n`;
  }

  await fs.promises.writeFile(envPath, newContent);
}
