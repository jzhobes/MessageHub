#!/bin/bash
# Unix (Mac/Linux) Setup Script

set -e  # Exit on error

echo "==> Setting up MessageHub environment..."

# 1. Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment 'venv'..."
    python3 -m venv venv
else
    echo "Found existing virtual environment."
fi

# 2. Activate and install requirements
# Note: This activates it only for this script execution
source venv/bin/activate

echo "Installing dependencies from scripts/requirements.txt..."
pip install -r scripts/requirements.txt

echo ""
echo "✅ Setup Complete!"
echo "To execute scripts, use: ./venv/bin/python scripts/ingest.py"
echo "Or activate your shell with: source venv/bin/activate"
