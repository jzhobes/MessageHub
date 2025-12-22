import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// Set Workspace Path to the sample data created by build_samples.sh
const samplesDir = path.resolve(__dirname, '../data_samples');
process.env.WORKSPACE_PATH = samplesDir;

// Verify DB exists
const dbPath = path.join(samplesDir, 'messagehub.db');
if (!fs.existsSync(dbPath)) {
  console.log('⚠️ Sample database not found. Building it now...');
  try {
    const projectRoot = path.resolve(__dirname, '..');
    const isWin = process.platform === 'win32';

    // 2. Run build samples
    const buildScript = isWin ? 'build_samples.bat' : './build_samples.sh';
    execSync(buildScript, {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    console.log('✅ Sample database built successfully.');
  } catch (e) {
    throw new Error(`Failed to build sample database: ${e instanceof Error ? e.message : String(e)}`);
  }
}
