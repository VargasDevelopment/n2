import type Database from 'better-sqlite3';

export const addSettings = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    const workspaceColumns = sqlite.pragma('table_info(workspaces)') as { name: string }[];
    if (!workspaceColumns.some(({ name }) => name === 'initial_settings')) {
      sqlite.exec(`
        ALTER TABLE workspaces
        ADD COLUMN initial_settings TEXT NOT NULL DEFAULT '{}';
      `);
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS application_preferences (
        key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('handleOrientation', 'minimapVisible')),
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (key = 'handleOrientation' AND value IN ('"horizontal"', '"vertical"')) OR
          (key = 'minimapVisible' AND value IN ('true', 'false'))
        )
      );

      CREATE TABLE IF NOT EXISTS project_setting_overrides (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        key TEXT NOT NULL CHECK (key IN ('handleOrientation', 'minimapVisible')),
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key),
        CHECK (
          (key = 'handleOrientation' AND value IN ('"horizontal"', '"vertical"')) OR
          (key = 'minimapVisible' AND value IN ('true', 'false'))
        )
      );
      CREATE INDEX IF NOT EXISTS project_setting_overrides_workspace_id_idx
      ON project_setting_overrides(workspace_id);
    `);
    sqlite.pragma('user_version = 12');
  })();
};
