
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');

  if (!filePath) {
    return new NextResponse('Missing path', { status: 400 });
  }

  // Security check: ensure path is within allowed directories.
  // We can't strictly block '..' because the stickers might be in ../../../stickers_used/
  // Instead we rely on the final path check against baseDir.

  // Construct absolute path
  // Base: data/FB
  const baseDir = path.resolve(process.cwd(), '../data/FB');
  const absolutePath = path.join(baseDir, filePath);

  // Allow reading only from baseDir
  if (!absolutePath.startsWith(baseDir)) {
      return new NextResponse('Access denied', { status: 403 });
  }

  if (!fs.existsSync(absolutePath)) {
    return new NextResponse('File not found', { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(absolutePath);
    
    // Determine content type
    const ext = path.extname(absolutePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.mp4') contentType = 'video/mp4';
    else if (ext === '.mov') contentType = 'video/quicktime';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    console.error("Error serving media:", error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
