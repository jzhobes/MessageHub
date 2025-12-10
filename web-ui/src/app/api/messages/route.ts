
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get('threadId');
  const page = searchParams.get('page') || '1';

  if (!threadId) {
    return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
  }

  // Construct path
  // ../data/FB/your_facebook_activity/messages/inbox/{threadId}/message_{page}.json
  const msgPath = path.join(
    process.cwd(), 
    '../data/FB/your_facebook_activity/messages/inbox', 
    threadId, 
    `message_${page}.json`
  );

  try {
    if (!fs.existsSync(msgPath)) {
         return NextResponse.json({ error: 'Message file not found' }, { status: 404 }); 
    }
    
    // We also need to fix encoding usually? text is usually utf-8.
    // FB data might have encoding issues (latin1 vs utf8)
    // The Python script earlier saw "Maggie Wong" correct.
    // But typically FB JSON export has escaped unicode like \u00f3.
    // JSON.parse handles unicode escapes automatically. 
    // BUT sometimes FB exports have mojibake if not handled right. 
    // We will just return the JSON as is for now.
    
    const fileContents = fs.readFileSync(msgPath, 'utf8');
    const data = JSON.parse(fileContents);
    
    // Facebook Export Encoding Fix
    // They often export UTF-8 bytes decoded as Latin-1.
    // We need to re-encode to latin1 then decode as utf-8.
    const fixString = (str: string) => {
      try {
        let decoded = Buffer.from(str, 'latin1').toString('utf8');
        // Fix for "Heavy Black Heart" (U+2764) -> Red Heart (U+2764 U+FE0F)
        // Only if it's the exact character, or maybe globally?
        // Let's do globally for FB messages.
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
    console.error("Error reading message file:", error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
