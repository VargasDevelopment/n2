import Database from 'better-sqlite3';
import { closeSync, lstatSync, openSync } from 'node:fs';
import { LATEST_SCHEMA_VERSION } from './schemaMigrations.js';

export function requireDatabaseFile(path: string): void {
  const file = lstatSync(path);
  if (!file.isFile() || file.size === 0) {
    throw new Error('Refusing to create or replace the authoritative N2 dataset');
  }
}

export function requireN2Library(path: string): void {
  let database: Database.Database | undefined;
  try {
    requireDatabaseFile(path);
    database = new Database(path, { readonly: true, fileMustExist: true });
    const version = Number(database.pragma('user_version', { simple: true }));
    if (version < 0 || version > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Schema version ${version} is outside the supported range 0–${LATEST_SCHEMA_VERSION}`
      );
    }

    // Version zero predates migration tracking. These tables and columns identify both the
    // original N2 library and its later schemas without bootstrapping an unrelated SQLite file.
    const coreColumns = {
      workspaces: ['id', 'name'],
      nodes: [
        'id',
        'workspace_id',
        'title',
        'kind',
        'requested_status',
        'position_x',
        'position_y',
        'version',
        'created_at',
        'updated_at'
      ],
      edges: ['id', 'workspace_id', 'source', 'target', 'kind', 'created_at']
    };
    const tables = new Set(
      database
        .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(({ name }) => name)
    );
    for (const [table, columns] of Object.entries(coreColumns)) {
      if (!tables.has(table)) throw new Error(`Missing N2 core table: ${table}`);
      database.prepare(`SELECT ${columns.join(', ')} FROM ${table} LIMIT 0`).all();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Refusing authoritative N2 database at "${path}": ${reason}`, { cause: error });
  } finally {
    database?.close();
  }
}

/**
 * How a repository treats its library path:
 * - `existing` opens only an existing N2 library and never creates one (production).
 * - `create-if-missing` creates a new library when nothing at all is at the path, and otherwise
 *   applies the same checks as `existing` (self-hosting).
 * - `unchecked` lets SQLite open or create whatever is there (development and tests).
 */
export type LibraryOpening = 'existing' | 'create-if-missing' | 'unchecked';

export function openDatabase(
  path: string,
  opening: LibraryOpening,
  connection: Pick<Database.Options, 'timeout' | 'verbose'> = {}
): Database.Database {
  const created = opening === 'create-if-missing' && createLibraryFile(path);
  if (opening !== 'unchecked' && !created) requireN2Library(path);
  // SQLite must also refuse creation if the file disappears after the filesystem check.
  const database = new Database(path, { ...connection, fileMustExist: opening !== 'unchecked' });
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}

/**
 * Creates an empty owner-only file and returns true, or returns false when anything is already at
 * the path. The exclusive create fails for a symlink too, even a dangling one, so it is never
 * followed; the library checks then refuse it.
 */
function createLibraryFile(path: string): boolean {
  try {
    closeSync(openSync(path, 'wx', 0o600));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

export function databaseReadiness(database: Database.Database): { schemaVersion: number } {
  database.prepare('SELECT 1').get();
  return { schemaVersion: Number(database.pragma('user_version', { simple: true })) };
}
