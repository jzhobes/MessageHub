#!/bin/bash
set -e
set -m  # Enable job control so we can stop the whole server process group.

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

# Hash the Node ABI, platform, architecture, and dependency manifests.
# That reruns installs when dependencies change or native addons like better-sqlite3 need a rebuild.
compute_deps_hash() {
  node -e "
    const crypto = require('crypto');
    const fs = require('fs');
    const h = crypto.createHash('sha256');
    h.update([process.versions.modules, process.platform, process.arch].join(':') + '\0');
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
    npm ci
  else
    npm install
  fi
  compute_deps_hash > "$HASH_FILE"
  DEPS_UPDATED=true
fi

# Rebuild if the server build is missing, is the wrong kind, or is older than the dependencies or inputs.
BUILD_ID=".next/BUILD_ID"
SERVER_BUILD_MARKER=".next/.messagehub-server-build"
BUILD_NEEDED=false

if [ ! -f "$BUILD_ID" ] || [ ! -f "$SERVER_BUILD_MARKER" ] || [ "$DEPS_UPDATED" = true ]; then
  BUILD_NEEDED=true
else
  # Compare source files, public assets, and config against BUILD_ID.
  NEWER_FILES=$(find src public package.json package-lock.json tsconfig.json next.config.ts -type f -newer "$BUILD_ID" 2>/dev/null | head -n 1)
  if [ -n "$NEWER_FILES" ]; then
    echo "==> Changes detected (e.g., $NEWER_FILES). Rebuilding..."
    BUILD_NEEDED=true
  fi
fi

if [ "$BUILD_NEEDED" = true ]; then
  echo "==> Performing production build..."
  rm -f "$SERVER_BUILD_MARKER"
  npm run build
  touch "$SERVER_BUILD_MARKER"
else
  echo "==> Build is up-to-date. Skipping..."
fi

PORT="${PORT:-3000}"
APP_URL="http://localhost:${PORT}"

echo ""
echo "----------------------------------------------------------------"
echo "🚀 MessageHub is launching!"
echo "📍 Open: ${APP_URL}"
echo "----------------------------------------------------------------"
echo ""

# Try to open APP_URL in the default browser on macOS, WSL, or Linux.
open_browser() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$APP_URL" >/dev/null 2>&1 || true
  elif grep -qi microsoft /proc/version 2>/dev/null; then
    explorer.exe "$APP_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
  fi
}

SERVER_PID=""
BROWSER_CHECK_PID=""

# Stop the readiness check and the server process group.
# INT, TERM, and EXIT can all call this safely.
cleanup() {
  if [[ -n "$BROWSER_CHECK_PID" ]]; then
    kill -TERM -- "-$BROWSER_CHECK_PID" 2>/dev/null || true
    wait "$BROWSER_CHECK_PID" 2>/dev/null || true
    BROWSER_CHECK_PID=""
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "==> Stopping MessageHub..."
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}

trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

# Check the home page without querying database readiness.
wait_for_http() {
  node --input-type=module - "$APP_URL" "$SERVER_PID" <<'JS'
import { setTimeout as delay } from 'node:timers/promises';

const [url, pid] = process.argv.slice(2);
const deadline = Date.now() + 30_000;
const serverIsRunning = () => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

while (serverIsRunning() && Date.now() < deadline) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))),
    });
    if (response.ok && serverIsRunning()) {
      process.exit(0);
    }
  } catch {
    // The HTTP listener may not be ready yet.
  }
  await delay(250);
}
process.exitCode = 1;
JS
}

# Job control puts each background job into its own process group for cleanup.
./node_modules/.bin/next start -p "$PORT" &
SERVER_PID=$!

(
  if wait_for_http; then
    open_browser
  elif kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "==> Browser auto-open timed out. Open ${APP_URL} manually."
  fi
) &
BROWSER_CHECK_PID=$!

wait "$SERVER_PID"
