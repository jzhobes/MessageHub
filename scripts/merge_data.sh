#!/bin/bash

# Define merge target
TARGET_DIR="merged_facebook_data"
mkdir -p "$TARGET_DIR"

echo "Starting merge into $TARGET_DIR..."

# Loop through all extracted directories
for dir in *_extracted; do
    if [ -d "$dir" ]; then
        echo "Merging $dir..."
        # rsync -a preserves attributes and recurses. 
        # The trailing slash on $dir/ ensures we copy the CONTENTS of $dir into $TARGET_DIR
        rsync -a "$dir/" "$TARGET_DIR/"
    fi
done

echo "Merge complete! All data is in $TARGET_DIR."
