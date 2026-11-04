import type Database from 'better-sqlite3';

// Additive and idempotent: an unversioned database detected as version 13 may already carry the
// columns, and every existing Project starts unarchived at lifecycle revision 0 (ADR 0012).
export const addProjectArchive = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    const workspaceColumns = sqlite.pragma('table_info(workspaces)') as { name: string }[];
    if (!workspaceColumns.some(({ name }) => name === 'archived_at')) {
      sqlite.exec('ALTER TABLE workspaces ADD COLUMN archived_at TEXT;');
    }
    if (!workspaceColumns.some(({ name }) => name === 'lifecycle_revision')) {
      sqlite.exec(
        'ALTER TABLE workspaces ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0;'
      );
    }
    sqlite.pragma('user_version = 14');
  })();
};
