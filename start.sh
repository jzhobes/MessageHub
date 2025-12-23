#!/bin/bash
set -e
set -m  # enable job control so we can manage process groups reliably

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -f "$PROJECT_ROOT/setup.sh" ]; then
  "$PROJECT_ROOT/setup.sh"
fi

cd "$PROJECT_ROOT/webapp"
if [ ! -d "node_modules" ]; then
  echo "==> Installing Node dependencies..."
  npm install
fi

if [ ! -f ".next/BUILD_ID" ]; then
  echo "==> Performing production build..."
  npm run build
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
