import fs from 'fs';
import path from 'path';
import os from 'os';
import { getProjectRoot } from './python';

/**
 * Updates the .env file with the provided workspace path.
 * This ensures the configuration persists across application restarts.
 * Also initializes root boundaries if they are missing.
 */
export async function persistWorkspacePath(workspacePath: string): Promise<void> {
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
    newContent = newContent.replace(/^WORKSPACE_PATH=.*$/m, `WORKSPACE_PATH=${workspacePath}`);
  } else {
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `WORKSPACE_PATH=${workspacePath}\n`;
  }

  // 2. Ensure Security Roots exist (default to HOME)
  const homeDir = os.homedir();
  if (!/^ROOT_IMPORT_PATH=/m.test(newContent)) {
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `ROOT_IMPORT_PATH="${homeDir}"\n`;
  }
  if (!/^ROOT_WORKSPACE_PATH=/m.test(newContent)) {
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `ROOT_WORKSPACE_PATH="${homeDir}"\n`;
  }

  await fs.promises.writeFile(envPath, newContent);
}
