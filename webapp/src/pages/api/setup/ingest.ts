import type { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'child_process';
import { setupSSE } from '@/lib/server/sse';
import appConfig from '@/lib/shared/appConfig';
import { getPythonPath, getIngestScriptPath } from '@/lib/server/python';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const dataDir = appConfig.WORKSPACE_PATH;
  const scriptPath = getIngestScriptPath();
  const pythonPath = await getPythonPath();

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
