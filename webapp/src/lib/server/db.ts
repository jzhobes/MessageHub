import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getDataDir } from '@/lib/shared/config';

let dbInstance: Database.Database | null = null;

export function dbExists(): boolean {
  if (dbInstance) {
    return true;
  }
  try {
    const dataDir = getDataDir();
    const dbPath = path.join(dataDir, 'messagehub.db');
    return fs.existsSync(dbPath);
  } catch (e) {
    return false;
  }
}

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'messagehub.db');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at ${dbPath}. Please run setup.`);
  }

  try {
    dbInstance = new Database(dbPath, { readonly: true });
    return dbInstance;
  } catch (e) {
    console.error(`Failed to open database at ${dbPath}`, e);
    throw e;
  }
}
