import { ProjectApplication } from '@n2/application';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';
import { addThemePreference } from '../src/themeMigration.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'n2-system-theme-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

it.each(['midnight', 'mono', 'paper', 'ember', undefined] as const)(
  'migrates schema 16 with Theme %s intact, then durably stores System',
  (theme) => {
    const path = join(directory, 'library.sqlite');
    let repository = createTestProjectRepository(path);
    let application = new ProjectApplication(repository);
    application.updateApplicationPreference({ key: 'handleOrientation', value: 'vertical' });
    application.updateApplicationPreference({ key: 'minimapVisible', value: false });
    if (theme) application.updateApplicationPreference({ key: 'theme', value: theme });
    const preferences = application.queryApplicationPreferences();
    repository.close();

    // Restore the actual pre-System CHECK constraint, keeping the schema-16 Activity tables.
    const legacy = new Database(path);
    addThemePreference(legacy);
    legacy.pragma('user_version = 16');
    const rows = legacy.prepare('SELECT * FROM application_preferences ORDER BY key').all();
    expect(() =>
      legacy
        .prepare(
          "INSERT OR REPLACE INTO application_preferences VALUES ('theme', '\"system\"', 'now')"
        )
        .run()
    ).toThrow();
    legacy.close();

    repository = new ProjectRepository(path, { opening: 'existing' });
    application = new ProjectApplication(repository);
    expect(application.queryApplicationPreferences()).toEqual(preferences);
    expect(repository.readiness()).toEqual({ schemaVersion: LATEST_SCHEMA_VERSION });
    repository.close();
    const migrated = new Database(path);
    expect(migrated.prepare('SELECT * FROM application_preferences ORDER BY key').all()).toEqual(
      rows
    );
    expect(migrated.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(migrated.pragma('foreign_key_check')).toEqual([]);
    expect(() =>
      migrated
        .prepare(
          "INSERT OR REPLACE INTO application_preferences VALUES ('theme', '\"auto\"', 'now')"
        )
        .run()
    ).toThrow();
    migrated.close();

    repository = new ProjectRepository(path);
    new ProjectApplication(repository).updateApplicationPreference({
      key: 'theme',
      value: 'system'
    });
    repository.close();
    repository = new ProjectRepository(path);
    expect(new ProjectApplication(repository).queryApplicationPreferences().storedValues).toEqual({
      handleOrientation: 'vertical',
      minimapVisible: false,
      theme: 'system'
    });
    repository.close();
  }
);
