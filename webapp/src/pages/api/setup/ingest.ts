import type { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import appConfig from '@/lib/shared/appConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const dataDir = appConfig.DATA_PATH;
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.(); // Ensure headers sent immediately if possible

  const env = { ...process.env, DATA_PATH: dataDir, PYTHONUNBUFFERED: '1' };

  const child = spawn(pythonPath, [scriptPath], { env });

  const sendEvent = (type: string, payload: unknown) => {
    res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
  };

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        sendEvent('stdout', line.trim());
      }
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        sendEvent('stderr', line.trim());
      }
    }
  });

  child.on('close', (code) => {
    sendEvent('done', { code });
    res.end();
  });

  child.on('error', (e) => {
    sendEvent('error', e.message);
    res.end();
  });

  req.on('close', () => {
    child.kill();
  });
}
