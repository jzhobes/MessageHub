import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get('threadId');
  const page = searchParams.get('page') || '1';
  const platform = searchParams.get('platform');

  if (!threadId) {
    return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
  }

  let inboxPath;
  if (platform === 'Facebook') {
    inboxPath = path.join(process.cwd(), '../data/your_facebook_activity/messages/inbox');
  } else if (platform === 'Instagram') {
    inboxPath = path.join(process.cwd(), '../data/your_instagram_activity/messages/inbox');
  } else {
    // Fallback for backward compat or fail? Let's default to FB if undefined but fail if unknown?
    // Actually better to fail if unknown platform.
    // But for robustness let's see. If platform is missing, maybe default FB?
    // Or just return 400.
    if (!platform) {
      inboxPath = path.join(process.cwd(), '../data/your_facebook_activity/messages/inbox');
    } else {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }
  }

  // Construct path
  const msgPath = path.join(inboxPath, threadId, `message_${page}.json`);

  try {
    if (!fs.existsSync(msgPath)) {
      return NextResponse.json({ error: 'Message file not found' }, { status: 404 });
    }

    const fileContents = fs.readFileSync(msgPath, 'utf8');
    const data = JSON.parse(fileContents);

    // Facebook Export Encoding Fix
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
    console.error('Error reading message file:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
