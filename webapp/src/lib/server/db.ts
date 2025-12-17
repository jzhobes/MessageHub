import Database from 'better-sqlite3';
import path from 'path';
import { getDataDir } from '@/lib/shared/config';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'messagehub.db');

  try {
    dbInstance = new Database(dbPath, { readonly: true });
    return dbInstance;
  } catch (e) {
    console.error(`Failed to open database at ${dbPath}`, e);
    throw e;
  }
}
