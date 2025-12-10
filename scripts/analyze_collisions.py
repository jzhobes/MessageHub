import os
import glob
from collections import defaultdict

import hashlib

def get_file_hash(filepath):
    """Calculates the MD5 hash of a file."""
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        buf = f.read(65536)
        while len(buf) > 0:
            hasher.update(buf)
            buf = f.read(65536)
    return hasher.hexdigest()

def analyze_merged_structure(base_dir):
    extracted_dirs = sorted([d for d in os.listdir(base_dir) if d.endswith('_extracted') and os.path.isdir(os.path.join(base_dir, d))])
    
    # dictionary to store filepath -> list of source directories
    file_map = defaultdict(list)
    
    print(f"Analyzing {len(extracted_dirs)} directories...")
    
    for d in extracted_dirs:
        full_dir_path = os.path.join(base_dir, d)
        print(f"Scanning {d}...")
        for root, _, files in os.walk(full_dir_path):
            for file in files:
                # Absolute path of the source file
                abs_path = os.path.join(root, file)
                
                # Relative path from the extracted root (e.g. inside facebook-jzhobes..._extracted/)
                # We want to merge the CONTENTS of the extracted dir.
                # Usually that content starts with "your_facebook_activity"
                rel_path = os.path.relpath(abs_path, full_dir_path)
                
                file_map[rel_path].append(d)

    collisions = {k: v for k, v in file_map.items() if len(v) > 1}
    
    return collisions, file_map, extracted_dirs

if __name__ == "__main__":
    base_dir = "/Users/johnho/Projects/virtual-me/data/FB"
    collisions, file_map, extracted_dirs = analyze_merged_structure(base_dir)
    
    if collisions:
        print(f"\nFound {len(collisions)} collisions.")
        identical_count = 0
        different_count = 0
        
        for path, sources in collisions.items():
            # Check hashes (which implicitly checks size/content)
            hashes = []
            for src_dir in sources:
                full_path = os.path.join(base_dir, src_dir, path)
                hashes.append(get_file_hash(full_path))
            
            if len(set(hashes)) == 1:
                identical_count += 1
            else:
                different_count += 1
                if different_count <= 5:
                    print(f"  DIFFERENT CONTENT: {path}")
                    print(f"    Hashes: {hashes}")

        print(f"Summary: {identical_count} identical by content (hash), {different_count} different by content.")
        
        if different_count == 0:
             print("ALL_COLLISIONS_IDENTICAL")
        else:
             print("SOME_COLLISIONS_DIFFERENT")
    else:
        print("\nNo collisions found. Ready to merge.")
        print("NO_COLLISIONS")
