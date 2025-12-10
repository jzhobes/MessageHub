
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
    
    // A little fix for FB's weird encoding if needed.
    // Ideally we fix this at display time or we implement a fix function.
    // For now, raw.
    
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error reading message file:", error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
