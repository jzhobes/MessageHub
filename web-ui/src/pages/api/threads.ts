import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { platform } = req.query;
  const platformStr = Array.isArray(platform) ? platform[0] : platform;

  let indexPath;
  if (platformStr === 'Facebook') {
    indexPath = path.join(process.cwd(), '../data/fb_threads_index.json');
  } else if (platformStr === 'Instagram') {
    indexPath = path.join(process.cwd(), '../data/ig_threads_index.json');
  } else if (platformStr === 'Google Chat') {
    indexPath = path.join(process.cwd(), '../data/google_chat_threads_index.json');
  } else {
    return res.status(200).json([]);
  }

  try {
    const fileContents = fs.readFileSync(indexPath, 'utf8');
    const data = JSON.parse(fileContents);

    // Facebook Encoding Fix
    const fixString = (str: string) => {
      try {
        let decoded = Buffer.from(str, 'latin1').toString('utf8');
        decoded = decoded.replace(/\u2764(?!\uFE0F)/g, '\u2764\uFE0F');
        return decoded;
      } catch (e) {
        return str;
      }
    };

    const fixRecursive = (obj: any): any => {
      if (typeof obj === 'string') {
        return fixString(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(fixRecursive);
      } else if (obj && typeof obj === 'object') {
        const newObj: any = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = fixRecursive(obj[key]);
          }
        }
        return newObj;
      }
      return obj;
    };

    const fixedData = fixRecursive(data);
    return res.status(200).json(fixedData);
  } catch (error) {
    console.error('Error reading index:', error);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
}
