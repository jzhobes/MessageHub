#!/bin/bash
set -e
set -m  # enable job control so we can manage process groups reliably

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js 26+ is required, but 'node' was not found on PATH." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 26 ]; then
  echo "❌ Node.js 26+ is required (found $(node -v)). Please upgrade Node.js." >&2
  exit 1
fi

if [ -f "$PROJECT_ROOT/setup.sh" ]; then
  "$PROJECT_ROOT/setup.sh"
fi

cd "$PROJECT_ROOT/webapp"

compute_deps_hash() {
  node -e "
    const crypto = require('crypto');
    const fs = require('fs');
    const h = crypto.createHash('sha256');
    for (const f of ['package.json', 'package-lock.json']) {
      if (fs.existsSync(f)) {
        h.update(f + '\0');
        h.update(fs.readFileSync(f));
      }
    }
    process.stdout.write(h.digest('hex'));
  "
}

HASH_FILE="node_modules/.install-hash"
CURRENT_HASH=$(compute_deps_hash)
INSTALLED_HASH=""
if [ -f "$HASH_FILE" ]; then
  INSTALLED_HASH=$(cat "$HASH_FILE")
fi

DEPS_UPDATED=false
if [ ! -d "node_modules" ] || [ "$CURRENT_HASH" != "$INSTALLED_HASH" ]; then
  echo "==> Installing Node dependencies..."
  if [ -f "package-lock.json" ]; then
    npm ci || npm install
  else
    npm install
  fi
  compute_deps_hash > "$HASH_FILE"
  DEPS_UPDATED=true
fi

# 3. Smart Build: Only build if source files have changed or build is missing
BUILD_ID=".next/BUILD_ID"
BUILD_NEEDED=false

if [ ! -f "$BUILD_ID" ] || [ "$DEPS_UPDATED" = true ]; then
  BUILD_NEEDED=true
else
  # Find any file in webapp (excluding node_modules and .next) newer than BUILD_ID
  # We focus on src, public, and config files.
  NEWER_FILES=$(find src public package.json package-lock.json tsconfig.json next.config.ts -type f -newer "$BUILD_ID" 2>/dev/null | head -n 1)
  if [ -n "$NEWER_FILES" ]; then
    echo "==> Changes detected (e.g., $NEWER_FILES). Rebuilding..."
    BUILD_NEEDED=true
  fi
fi

if [ "$BUILD_NEEDED" = true ]; then
  echo "==> Performing production build..."
  npm run build
else
  echo "==> Build is up-to-date. Skipping..."
fi

echo ""
echo "----------------------------------------------------------------"
echo "🚀 MessageHub is launching!"
echo "📍 Open: http://localhost:3000"
echo "----------------------------------------------------------------"
echo ""

{
  sleep 2
  url="http://localhost:3000"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$url" >/dev/null 2>&1 || true
  elif grep -qi microsoft /proc/version 2>/dev/null; then
    explorer.exe "$url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
} </dev/null >/dev/null 2>&1 & disown

SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "==> Stopping MessageHub..."
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}

trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

# Start the production server in the background and capture its PID
# We don't need setsid because set -m + & already handles process group isolation
./node_modules/.bin/next start &
SERVER_PID=$!

wait "$SERVER_PID"
