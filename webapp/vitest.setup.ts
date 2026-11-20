import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { vi } from 'vitest';

// Point the test workspace at the output of build_samples.sh.
const samplesDir = path.resolve(__dirname, '../data_samples');
process.env.WORKSPACE_PATH = samplesDir;

// Check that the sample database is ready.
const dbPath = path.join(samplesDir, 'messagehub.db');
if (!fs.existsSync(dbPath)) {
  console.log('⚠️ Sample database not found. Building it now...');
  try {
    const projectRoot = path.resolve(__dirname, '..');

    // Build the sample workspace if the database is missing.
    execSync('./build_samples.sh', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    console.log('✅ Sample database built successfully.');
  } catch (e) {
    throw new Error(`Failed to build sample database: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Provide the dialog methods jsdom is missing.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
}

// Fill in Popover API methods only when jsdom doesn't provide them.
if (typeof HTMLElement !== 'undefined') {
  if (!HTMLElement.prototype.showPopover) {
    HTMLElement.prototype.showPopover = vi.fn();
  }
  if (!HTMLElement.prototype.hidePopover) {
    HTMLElement.prototype.hidePopover = vi.fn();
  }
}
