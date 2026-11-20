import fs from 'fs';
import os from 'os';
import path from 'path';

import { getProjectRoot } from './python';

/**
 * Quote the workspace path so it stays one .env value. Reject control characters and variable
 * expressions the Next.js loader would interpret.
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
 * Save the workspace path to .env so it survives a restart. Fill in the root boundaries if they're
 * missing.
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
    // Start with an empty file if .env doesn't exist yet.
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

  // Use HOME for any security root that hasn't been configured.
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
