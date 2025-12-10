#!/bin/bash

# Loop through all zip files in the current directory
for zip_file in *.zip; do
    # Create a directory name based on the zip filename (removing the extension)
    dir_name="${zip_file%.zip}_extracted"
    
    echo "Processing $zip_file..."
    
    # Create the directory
    mkdir -p "$dir_name"
    
    # Extract the zip file into the new directory
    unzip -q "$zip_file" -d "$dir_name"
    
    echo "Extracted $zip_file to $dir_name"
done
