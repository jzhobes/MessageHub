import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import appConfig from '@/lib/shared/appConfig';

/**
 * DatabaseService manages the connection to the SQLite database.
 * It ensures a single instance (singleton) is used throughout the application.
 */
class DatabaseService {
  private _instance: Database.Database | null = null;

  public exists(): boolean {
    try {
      const dbPath = path.join(appConfig.WORKSPACE_PATH, 'messagehub.db');
      return fs.existsSync(dbPath);
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the active database connection.
   * Opens a new connection if none exists.
   */
  public get(): Database.Database {
    if (this._instance) {
      return this._instance;
    }

    const dbPath = path.join(appConfig.WORKSPACE_PATH, 'messagehub.db');

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database file not found at ${dbPath}. Please run setup.`);
    }

    try {
      this._instance = new Database(dbPath, { readonly: true });
      this._instance.pragma('foreign_keys = ON');
      return this._instance;
    } catch (e) {
      console.error(`Failed to open database at ${dbPath}`, e);
      throw e;
    }
  }

  /**
   * Closes the database connection and resets the singleton instance.
   */
  public close(): void {
    if (this._instance) {
      try {
        this._instance.close();
      } catch (e) {
        console.error('Error closing database connection:', e);
      } finally {
        this._instance = null;
      }
    }
  }

  public reconnect(): Database.Database {
    this.close();
    return this.get();
  }
}

// Export a single instance of the database service as default
const db = new DatabaseService();
export default db;
