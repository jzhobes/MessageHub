import db from './db';

/**
 * Retrieves the potential names for the current user ("Me") from the identities table in the database.
 */
export async function getMyNames(): Promise<string[]> {
  const myNamesSet = new Set<string>(['Me']);

  try {
    if (db.exists()) {
      const conn = db.get();
      const tableCheck = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='identities'").get();
      if (tableCheck) {
        const rows = conn
          .prepare("SELECT id_value FROM identities WHERE is_me = 1 AND id_type IN ('name', 'email')")
          .all() as { id_value: string }[];
        rows.forEach((r) => myNamesSet.add(r.id_value));
      }
    }
  } catch (e) {
    console.warn('[Identity] Could not read identities from DB:', e);
  }

  return Array.from(myNamesSet);
}
