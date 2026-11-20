#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEBAPP_ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(WEBAPP_ROOT, '.demo-build-tmp');

const RELOCATED_PATHS = [
  { src: path.join(WEBAPP_ROOT, 'src', 'pages', 'api'), tmp: path.join(TMP_DIR, 'pages-api') },
  { src: path.join(WEBAPP_ROOT, 'src', 'instrumentation.ts'), tmp: path.join(TMP_DIR, 'instrumentation.ts') },
  { src: path.join(WEBAPP_ROOT, 'src', 'tests', 'api'), tmp: path.join(TMP_DIR, 'tests-api') },
];

let restored = false;

function restoreTempFiles() {
  if (restored) {
    return;
  }
  restored = true;

  for (const entry of RELOCATED_PATHS) {
    if (fs.existsSync(entry.tmp)) {
      fs.mkdirSync(path.dirname(entry.src), { recursive: true });
      fs.renameSync(entry.tmp, entry.src);
    }
  }

  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

if (fs.existsSync(TMP_DIR)) {
  console.error(
    `❌ Temp directory already exists at ${TMP_DIR}. Restore any relocated files before running build-demo.`,
  );
  process.exit(1);
}

const handleSignal = (signal) => {
  restoreTempFiles();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

let exitCode = 1;

try {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  for (const entry of RELOCATED_PATHS) {
    if (fs.existsSync(entry.src)) {
      fs.renameSync(entry.src, entry.tmp);
    }
  }

  fs.rmSync(path.join(WEBAPP_ROOT, '.next'), { recursive: true, force: true });
  fs.rmSync(path.join(WEBAPP_ROOT, 'out'), { recursive: true, force: true });

  const nextBin = path.join(WEBAPP_ROOT, 'node_modules', '.bin', 'next');
  const buildResult = spawnSync(nextBin, ['build'], {
    cwd: WEBAPP_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_DEMO_MODE: 'true',
      NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || '',
    },
  });

  exitCode = buildResult.status ?? 1;

  if (exitCode === 0) {
    const outDir = path.join(WEBAPP_ROOT, 'out');
    if (fs.existsSync(outDir)) {
      fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');
    }
    console.log('✅ Static demo exported to webapp/out/ (with .nojekyll)');
  }
} finally {
  restoreTempFiles();
}

process.exit(exitCode);
