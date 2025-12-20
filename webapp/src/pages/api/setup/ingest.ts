import type { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { setupSSE } from '@/lib/server/sse';
import appConfig from '@/lib/shared/appConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const dataDir = appConfig.WORKSPACE_PATH;
  const rootDir = path.resolve(process.cwd(), '../'); // Assuming webapp is subfolder of project
  const scriptPath = path.join(rootDir, 'scripts', 'ingest.py');

  try {
    await fs.promises.access(scriptPath);
  } catch {
    return res.status(500).json({ error: 'Ingestion script not found at ' + scriptPath });
  }

  // Resolve Python Path
  const isWin = process.platform === 'win32';
  const venvBin = isWin ? path.join('venv', 'Scripts') : path.join('venv', 'bin');
  const pythonExe = isWin ? 'python.exe' : 'python';

  let pythonPath = path.join(rootDir, venvBin, pythonExe);

  try {
    await fs.promises.access(pythonPath);
  } catch {
    // Fallback to system python
    pythonPath = 'python3';
    // On windows 'python' usually.
    if (isWin) {
      pythonPath = 'python';
    }
  }

  console.log(`Starting ingestion with ${pythonPath} on ${scriptPath} data=${dataDir}`);

  // Setup SSE
  const stream = setupSSE(res, { heartbeat: true });

  const env = { ...process.env, WORKSPACE_PATH: dataDir, PYTHONUNBUFFERED: '1' };

  const deleteArchives = req.query.deleteArchives === 'true';
  const args = ['-u', scriptPath];
  if (deleteArchives) {
    args.push('--delete-archives');
  }

  const child = spawn(pythonPath, args, { env });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        stream.send('stdout', line.trim());
        console.log(`[Ingest] ${line.trim()}`);
      }
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        stream.send('stderr', line.trim());
        console.error(`[Ingest Error] ${line.trim()}`);
      }
    }
  });

  child.on('close', (code) => {
    stream.send('done', { code });
    stream.close();
  });

  child.on('error', (e) => {
    stream.send('error', e.message);
    stream.close();
  });

  req.on('close', () => {
    stream.close();
    child.kill();
  });
}
