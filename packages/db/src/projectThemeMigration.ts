import type Database from 'better-sqlite3';

// Lets a Project pin a Theme by widening the override CHECKs, keeping every existing override and
// its timestamp. Nothing references project_setting_overrides, so a copy inside one transaction is
// safe; the new table restates its own workspace foreign key and index.
export const addProjectTheme = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE project_setting_overrides_next (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        key TEXT NOT NULL CHECK (key IN ('handleOrientation', 'minimapVisible', 'theme')),
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key),
        CHECK (
          (key = 'handleOrientation' AND value IN ('"horizontal"', '"vertical"')) OR
          (key = 'minimapVisible' AND value IN ('true', 'false')) OR
          (key = 'theme' AND value IN ('"midnight"', '"mono"', '"paper"', '"ember"', '"system"'))
        )
      );
      INSERT INTO project_setting_overrides_next (workspace_id, key, value, updated_at)
      SELECT workspace_id, key, value, updated_at FROM project_setting_overrides;
      DROP TABLE project_setting_overrides;
      ALTER TABLE project_setting_overrides_next RENAME TO project_setting_overrides;
      CREATE INDEX project_setting_overrides_workspace_id_idx
      ON project_setting_overrides(workspace_id);
    `);
    sqlite.pragma('user_version = 18');
  })();
};
