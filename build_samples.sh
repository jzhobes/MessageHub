#!/bin/bash
# Build the data_samples/ workspace from the archives in samples/.

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SAMPLES_DIR="$PROJECT_ROOT/samples"
DATA_SAMPLES_DIR="$PROJECT_ROOT/data_samples"


# Run setup first if the virtual environment is missing.
if [ ! -d "$PROJECT_ROOT/venv" ]; then
    echo "⚠️  Virtual environment not found. Running setup..."
    "$PROJECT_ROOT/setup.sh"
fi

echo "==> Building sample workspace in $DATA_SAMPLES_DIR..."

# Start with a clean sample workspace.
rm -rf "$DATA_SAMPLES_DIR"
mkdir -p "$DATA_SAMPLES_DIR"

# Copy the archives in so ingestion can work on the copies.
cp "$SAMPLES_DIR/facebook_sample.zip" "$DATA_SAMPLES_DIR/"
cp "$SAMPLES_DIR/instagram_sample.zip" "$DATA_SAMPLES_DIR/"
cp "$SAMPLES_DIR/google_chat_sample.zip" "$DATA_SAMPLES_DIR/"
cp "$SAMPLES_DIR/google_voice_sample.zip" "$DATA_SAMPLES_DIR/"
cp "$SAMPLES_DIR/google_mail_sample.zip" "$DATA_SAMPLES_DIR/"

# Run ingestion
echo "==> Running ingestion on samples..."
export WORKSPACE_PATH="$DATA_SAMPLES_DIR"
"$PROJECT_ROOT/venv/bin/python3" "$PROJECT_ROOT/scripts/ingest.py" --source "$DATA_SAMPLES_DIR" --delete-archives

echo ""
echo "✅ Sample workspace ready at $DATA_SAMPLES_DIR"
echo "You can now test search and chat features using this data."