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
echo "==> Starting MessageHub development server..."
npm run dev
