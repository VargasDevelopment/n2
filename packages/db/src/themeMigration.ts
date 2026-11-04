import type Database from 'better-sqlite3';

// SQLite cannot alter a CHECK constraint, so the table is rebuilt to admit the Theme preference.
// No foreign key references application_preferences, so a plain copy inside one transaction is safe.
export const addThemePreference = (sqlite: Database.Database): void => {
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE application_preferences_next (
        key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('handleOrientation', 'minimapVisible', 'theme')),
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (key = 'handleOrientation' AND value IN ('"horizontal"', '"vertical"')) OR
          (key = 'minimapVisible' AND value IN ('true', 'false')) OR
          (key = 'theme' AND value IN ('"midnight"', '"mono"', '"paper"', '"ember"'))
        )
      );
      INSERT INTO application_preferences_next (key, value, updated_at)
      SELECT key, value, updated_at FROM application_preferences;
      DROP TABLE application_preferences;
      ALTER TABLE application_preferences_next RENAME TO application_preferences;
    `);
    sqlite.pragma('user_version = 15');
  })();
};
