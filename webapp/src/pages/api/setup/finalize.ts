import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const currentPath = process.env.DATA_PATH;
  if (!currentPath) {
    return res.status(400).json({ error: 'No runtime DATA_PATH set. Complete setup first.' });
  }

  // Determine Project Root - same logic as elsewhere
  const currentDir = process.cwd();
  const projectRoot = path.basename(currentDir) === 'webapp' ? path.resolve(currentDir, '..') : currentDir;
  const envPath = path.resolve(projectRoot, '.env');

  try {
    let content = '';
    try {
      await fs.promises.access(envPath);
      content = await fs.promises.readFile(envPath, 'utf-8');
    } catch {
      // .env doesn't exist, start empty
    }

    let newContent = content;
    // Replace existing or append
    if (/^DATA_PATH=/m.test(newContent)) {
      newContent = newContent.replace(/^DATA_PATH=.*$/m, `DATA_PATH=${currentPath}`);
    } else {
      // Add newline if needed
      if (newContent && !newContent.endsWith('\n')) {
        newContent += '\n';
      }
      newContent += `DATA_PATH=${currentPath}\n`;
    }

    await fs.promises.writeFile(envPath, newContent);
    return res.status(200).json({ success: true, message: 'Configuration saved to .env' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Failed to write .env', e);
    return res.status(500).json({ error: `Failed to save configuration: ${message}` });
  }
}
