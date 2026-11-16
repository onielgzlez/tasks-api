import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  try {
    // Never sleep in SQLite's synchronous busy handler on the HTTP event loop.
    db.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = WAL;');
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function isDatabaseBusy(error: unknown): boolean {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'ERR_SQLITE_ERROR' ||
    !('errcode' in error) ||
    typeof error.errcode !== 'number'
  ) {
    return false;
  }
  // Include extended SQLITE_BUSY codes, but not SQLITE_LOCKED (a different conflict).
  return (error.errcode & 0xff) === 5;
}

export function migrate(
  db: DatabaseSync,
  directory = new URL('../migrations/', import.meta.url),
): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT`);
    for (const name of readdirSync(directory)
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort()) {
      const sql = readFileSync(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = db.prepare('SELECT checksum FROM schema_migrations WHERE name = ?').get(name);
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(`Applied migration changed: ${name}`);
        }
        continue;
      }
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(name, checksum) VALUES (?, ?)').run(name, checksum);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
