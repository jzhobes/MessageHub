#!/bin/bash
# MessageHub Start Script (Mac/Linux)
set -e

# 1. Ensure Python environment is ready
if [ -f "./setup.sh" ]; then
    ./setup.sh
else
    echo "❌ Error: setup.sh not found in $(pwd)"
    exit 1
fi

# 2. Handle Node dependencies in webapp directory
if [ -d "webapp" ]; then
    cd webapp
    if [ ! -d "node_modules" ]; then
        echo "==> node_modules not found. Installing dependencies..."
        npm install
    fi
else
    echo "❌ Error: webapp directory not found"
    exit 1
fi

# 3. Start the application
echo "==> Preparing MessageHub application..."

if [ ! -f ".next/BUILD_ID" ]; then
    echo "==> Production build not found (or only dev cache exists). Building now..."
    npm run build
fi

echo ""
echo "----------------------------------------------------------------"
echo "🚀 MessageHub is launching (Production Mode)!"
echo "📍 Open your browser at: http://localhost:3000"
echo "----------------------------------------------------------------"
echo ""

# Attempt to open the browser automatically
if grep -qi microsoft /proc/version; then
    # WSL
    explorer.exe "http://localhost:3000" > /dev/null 2>&1 || true
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # Mac
    open "http://localhost:3000" > /dev/null 2>&1 || true
elif command -v xdg-open > /dev/null; then
    # Linux
    xdg-open "http://localhost:3000" > /dev/null 2>&1 || true
fi

# Run the production server
npm run start
