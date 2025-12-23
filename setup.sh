#!/bin/bash
# MessageHub Setup Script (Mac/Linux)
set -e
trap "exit" INT

# Get the directory where this script is located
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "==> Setting up MessageHub environment in $PROJECT_ROOT..."

# 1. Create venv if it doesn't exist
if [ ! -d "$PROJECT_ROOT/venv" ]; then
    echo "Creating virtual environment 'venv'..."
    python3 -m venv "$PROJECT_ROOT/venv"
else
    echo "Found existing virtual environment."
fi

# 2. Activate and install requirements
# Note: This activates it only for this script execution
source "$PROJECT_ROOT/venv/bin/activate"

echo "Installing dependencies from $PROJECT_ROOT/scripts/requirements.txt..."
pip install -r "$PROJECT_ROOT/scripts/requirements.txt"

echo ""
echo "✅ Setup Complete!"
echo "To execute scripts, use: $PROJECT_ROOT/venv/bin/python $PROJECT_ROOT/scripts/ingest.py"
echo "Or activate your shell with: source $PROJECT_ROOT/venv/bin/activate"
