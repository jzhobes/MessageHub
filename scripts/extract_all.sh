#!/bin/bash

# Default to current directory if no argument is provided
TARGET_DIR="${1:-.}"

echo "Extracting zip files in: $TARGET_DIR"

# Loop through all zip files in the target directory
for zip_file in "$TARGET_DIR"/*.zip; do
    # Check if the file exists (in case no zip files matches)
    if [ ! -e "$zip_file" ]; then
        echo "No zip files found in $TARGET_DIR"
        exit 0
    fi

    echo "Processing $zip_file..."
    
    # Extract the zip file into the target directory
    # -o: overwrite existing files without prompting (essential for merging without interruption)
    unzip -o "$zip_file" -d "$TARGET_DIR"
    
    echo "Extracted $zip_file"
done
