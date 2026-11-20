#!/bin/bash
# Set up MessageHub on macOS, Linux, or WSL.
set -e
trap "exit" INT

# Resolve paths from the directory this script lives in.
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Verify Python 3.12+ is available
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Python 3.12+ is required, but 'python3' was not found on PATH." >&2
    exit 1
fi

if ! python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"; then
    echo "❌ Python 3.12+ is required (found $(python3 --version)). Please upgrade Python." >&2
    exit 1
fi

echo "==> Setting up MessageHub environment in $PROJECT_ROOT..."

# Create the virtual environment if it's missing. Recreate it if it's broken or outdated.
if [ -d "$PROJECT_ROOT/venv" ]; then
    if [ ! -x "$PROJECT_ROOT/venv/bin/python" ] || ! "$PROJECT_ROOT/venv/bin/python" -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"; then
        echo "Existing virtual environment is broken or uses Python < 3.12. Recreating 'venv'..."
        rm -rf "$PROJECT_ROOT/venv"
    fi
fi

if [ ! -d "$PROJECT_ROOT/venv" ]; then
    echo "Creating virtual environment 'venv'..."
    python3 -m venv "$PROJECT_ROOT/venv"
else
    echo "Found existing virtual environment."
fi

# Install requirements using the venv's Python
echo "Installing dependencies from $PROJECT_ROOT/scripts/requirements.txt..."
"$PROJECT_ROOT/venv/bin/python" -m pip install -r "$PROJECT_ROOT/scripts/requirements.txt"

echo ""
echo "✅ Setup Complete!"
echo "To execute scripts, use: $PROJECT_ROOT/venv/bin/python $PROJECT_ROOT/scripts/ingest.py"
echo "Or activate your shell with: source $PROJECT_ROOT/venv/bin/activate"
