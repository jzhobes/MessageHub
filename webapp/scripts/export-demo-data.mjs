#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEBAPP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEBAPP_ROOT, '..');

const workspacePath = path.resolve(process.env.WORKSPACE_PATH || path.join(REPO_ROOT, 'data_samples'));
const dbPath = path.join(workspacePath, 'messagehub.db');
const demoPublicDir = path.join(WEBAPP_ROOT, 'public', 'demo');
const demoMediaDir = path.join(demoPublicDir, 'media');
const dataJsonPath = path.join(demoPublicDir, 'data.json');

const MEDIA_EXTENSIONS = ['', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.mov', '.vcf'];

function isValidImageBuffer(ext, buf) {
  if (!buf || buf.length < 4) {
    return false;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === '.png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (ext === '.gif') {
    return buf.subarray(0, 4).toString('ascii') === 'GIF8';
  }
  if (ext === '.webp') {
    return (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return true;
}

function buildPlaceholderSvg(label) {
  const safeLabel = label.replace(/[<>&"']/g, '');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">',
    '  <defs>',
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '      <stop offset="0%" stop-color="#1e293b"/>',
    '      <stop offset="100%" stop-color="#0f172a"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <rect width="640" height="400" rx="16" fill="url(#bg)"/>',
    '  <circle cx="220" cy="145" r="32" fill="#38bdf8" opacity="0.85"/>',
    '  <path d="M120 310 L245 195 L340 280 L420 215 L520 310 Z" fill="#334155"/>',
    '  <rect x="170" y="328" width="300" height="30" rx="15" fill="#0f172a" opacity="0.75"/>',
    `  <text x="320" y="348" text-anchor="middle" fill="#e2e8f0" font-family="system-ui, sans-serif" font-size="14">${safeLabel}</text>`,
    '</svg>',
    '',
  ].join('\n');
}

function resolveCandidateRelativePaths(platform, filePath) {
  const p = platform.toLowerCase();
  const candidates = [];
  if (p === 'facebook') {
    candidates.push(
      path.join('Facebook', filePath.startsWith('your_facebook_activity') ? '' : 'your_facebook_activity', filePath),
    );
  } else if (p === 'instagram') {
    candidates.push(
      path.join('Instagram', filePath.startsWith('your_instagram_activity') ? '' : 'your_instagram_activity', filePath),
    );
  } else if (p === 'google_chat') {
    candidates.push(path.join('Google Chat/Groups', filePath), path.join('Google Chat/DMs', filePath));
  } else if (p === 'google_voice') {
    candidates.push(filePath.toLowerCase().startsWith('voice/') ? filePath : path.join('Voice', filePath));
  } else if (p === 'google_mail') {
    candidates.push(path.join('Mail', filePath));
  }
  candidates.push(filePath);
  return Array.from(new Set(candidates));
}

function findMediaFileOnDisk(platform, filePath) {
  if (!filePath || filePath.includes('..') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return null;
  }

  const baseResolved = path.resolve(workspacePath);
  const candidates = resolveCandidateRelativePaths(platform, filePath);

  for (const candidate of candidates) {
    for (const ext of MEDIA_EXTENSIONS) {
      const fullPath = path.resolve(baseResolved, candidate + ext);
      if (!fullPath.startsWith(baseResolved + path.sep)) {
        continue;
      }
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    }
  }
  return null;
}

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Database not found at ${dbPath}. Run ./build_samples.sh first or set WORKSPACE_PATH.`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

try {
  const hasIdentitiesTable = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='identities'")
    .get();
  const identities = hasIdentitiesTable
    ? db.prepare('SELECT platform, id_type, id_value, is_me, metadata_json FROM identities').all()
    : [];

  const threads = db.prepare('SELECT * FROM threads ORDER BY last_activity_ms DESC').all();
  const threadLabels = db.prepare('SELECT thread_id, label FROM thread_labels').all();
  const content = db.prepare('SELECT * FROM content ORDER BY timestamp_ms ASC, id ASC').all();

  const threadPlatformById = new Map(threads.map((t) => [t.id, t.platform]));

  fs.rmSync(demoPublicDir, { recursive: true, force: true });
  fs.mkdirSync(demoMediaDir, { recursive: true });

  const mediaManifest = {};
  let copiedFiles = 0;
  let placeholderFiles = 0;

  for (const row of content) {
    if (!row.media_json) {
      continue;
    }
    const platform = (threadPlatformById.get(row.thread_id) || 'unknown').toLowerCase();
    let mediaItems = [];
    try {
      mediaItems = JSON.parse(row.media_json);
    } catch {
      continue;
    }
    if (!Array.isArray(mediaItems)) {
      continue;
    }

    for (const item of mediaItems) {
      const uris = [item?.uri, item?.thumbnail_uri].filter(Boolean);
      for (const rawUri of uris) {
        if (rawUri.startsWith('http://') || rawUri.startsWith('https://')) {
          continue;
        }
        const manifestKey = `${platform}::${rawUri}`;
        if (mediaManifest[manifestKey]) {
          continue;
        }

        const diskPath = findMediaFileOnDisk(platform, rawUri);
        if (!diskPath) {
          continue;
        }

        const relUnderWorkspace = path.relative(workspacePath, diskPath);
        const safeSegments = relUnderWorkspace.split(path.sep).filter((seg) => seg && seg !== '.' && seg !== '..');
        const ext = path.extname(diskPath).toLowerCase();
        const fileBytes = fs.readFileSync(diskPath);

        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) && !isValidImageBuffer(ext, fileBytes)) {
          const svgRel = path.join(platform, ...safeSegments) + '.svg';
          const destSvgPath = path.join(demoMediaDir, svgRel);
          fs.mkdirSync(path.dirname(destSvgPath), { recursive: true });
          fs.writeFileSync(destSvgPath, buildPlaceholderSvg(`Sample Media · ${path.basename(diskPath)}`), 'utf8');
          mediaManifest[manifestKey] = `/demo/media/${svgRel.split(path.sep).join('/')}`;
          placeholderFiles++;
        } else {
          const mediaRel = path.join(platform, ...safeSegments);
          const destPath = path.join(demoMediaDir, mediaRel);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(diskPath, destPath);
          mediaManifest[manifestKey] = `/demo/media/${mediaRel.split(path.sep).join('/')}`;
          copiedFiles++;
        }
      }
    }
  }

  const bundle = {
    identities,
    threads,
    thread_labels: threadLabels,
    content,
    mediaManifest,
    linkPreviews: {},
  };

  fs.writeFileSync(dataJsonPath, JSON.stringify(bundle), 'utf8');
  const sizeKb = (Buffer.byteLength(JSON.stringify(bundle), 'utf8') / 1024).toFixed(1);

  console.log(
    `✅ Exported demo bundle to ${path.relative(WEBAPP_ROOT, dataJsonPath)} (${sizeKb} KB): ` +
      `${threads.length} threads, ${content.length} messages, ${copiedFiles} media file(s), ${placeholderFiles} SVG placeholder(s).`,
  );
} finally {
  db.close();
}
