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

    // Type for arbitrary JSON values
    type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

    // Facebook exports use Latin-1 encoding instead of UTF-8, causing emoji and special characters to be corrupted.
    // This function recursively walks the entire JSON structure and fixes all string values.
    const fixString = (str: string) => {
      try {
        let decoded = Buffer.from(str, 'latin1').toString('utf8');
        decoded = decoded.replace(/\u2764(?!\uFE0F)/g, '\u2764\uFE0F');
        return decoded;
      } catch {
        return str;
      }
    };

    const fixEncodingRecursive = (obj: JsonValue): JsonValue => {
      if (typeof obj === 'string') {
        return fixString(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(fixEncodingRecursive);
      } else if (obj && typeof obj === 'object') {
        const newObj: { [key: string]: JsonValue } = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = fixEncodingRecursive(obj[key]);
          }
        }
        return newObj;
      }
      return obj;
    };

    const fixedData = fixEncodingRecursive(data);
    return res.status(200).json(fixedData);
  } catch (error) {
    console.error('Error reading index:', error);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
}
