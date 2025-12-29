import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { vi } from 'vitest';

// Set Workspace Path to the sample data created by build_samples.sh
const samplesDir = path.resolve(__dirname, '../data_samples');
process.env.WORKSPACE_PATH = samplesDir;

// Verify DB exists
const dbPath = path.join(samplesDir, 'messagehub.db');
if (!fs.existsSync(dbPath)) {
  console.log('⚠️ Sample database not found. Building it now...');
  try {
    const projectRoot = path.resolve(__dirname, '..');

    // 2. Run build samples
    execSync('./build_samples.sh', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    console.log('✅ Sample database built successfully.');
  } catch (e) {
    throw new Error(`Failed to build sample database: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Mock HTMLDialogElement methods for JSDOM
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
}

// Mock Popover API methods if they don't exist in JSDOM
if (typeof HTMLElement !== 'undefined') {
  if (!HTMLElement.prototype.showPopover) {
    HTMLElement.prototype.showPopover = vi.fn();
  }
  if (!HTMLElement.prototype.hidePopover) {
    HTMLElement.prototype.hidePopover = vi.fn();
  }
}
