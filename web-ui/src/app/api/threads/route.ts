import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform');

  let indexPath;
  if (platform === 'Facebook') {
    indexPath = path.join(process.cwd(), '../data/fb_threads_index.json');
  } else if (platform === 'Instagram') {
    indexPath = path.join(process.cwd(), '../data/ig_threads_index.json');
  } else {
    return NextResponse.json([]);
  }

  try {
    const fileContents = fs.readFileSync(indexPath, 'utf8');
    const data = JSON.parse(fileContents);

    // Facebook Encoding Fix (Same as in messages)
    const fixString = (str: string) => {
      try {
        let decoded = Buffer.from(str, 'latin1').toString('utf8');
        // Fix for "Heavy Black Heart" (U+2764) -> Red Heart (U+2764 U+FE0F)
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
    return NextResponse.json(fixedData);
  } catch (error) {
    console.error('Error reading index:', error);
    return NextResponse.json({ error: 'Failed to load threads' }, { status: 500 });
  }
}
