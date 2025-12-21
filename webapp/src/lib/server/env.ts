import fs from 'fs';
import path from 'path';
import { getProjectRoot } from './python';

/**
 * Updates the .env file with the provided workspace path.
 * This ensures the configuration persists across application restarts.
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
  // Update WORKSPACE_PATH variable
  if (/^WORKSPACE_PATH=/m.test(newContent)) {
    newContent = newContent.replace(/^WORKSPACE_PATH=.*$/m, `WORKSPACE_PATH=${workspacePath}`);
  } else {
    // Append to file, ensuring a newline first if needed
    if (newContent && !newContent.endsWith('\n')) {
      newContent += '\n';
    }
    newContent += `WORKSPACE_PATH=${workspacePath}\n`;
  }

  await fs.promises.writeFile(envPath, newContent);
}
