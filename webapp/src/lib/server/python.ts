import fs from 'fs';
import path from 'path';

/**
 * Get the absolute path to the project root.
 */
export function getProjectRoot(): string {
  const currentDir = process.cwd();
  // When running from webapp, the project root is one level up.
  return path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;
}

/**
 * Get the absolute path to the Python ingestion script.
 */
export function getIngestScriptPath(): string {
  return path.join(getProjectRoot(), 'scripts', 'ingest.py');
}

/**
 * Use the project's virtual environment when available. Fall back to system Python.
 */
export async function getPythonPath(): Promise<string> {
  const projectRoot = getProjectRoot();
  const isWin = process.platform === 'win32';
  const venvBin = isWin ? path.join('venv', 'Scripts') : path.join('venv', 'bin');
  const pythonExe = isWin ? 'python.exe' : 'python';
  const venvPath = path.join(projectRoot, venvBin, pythonExe);

  try {
    await fs.promises.access(venvPath);
    return venvPath;
  } catch {
    // Fallback to system python
    return isWin ? 'python' : 'python3';
  }
}
