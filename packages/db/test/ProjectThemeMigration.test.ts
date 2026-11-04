import { ProjectApplication } from '@n2/application';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'n2-project-theme-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const overrideRows = (sqlite: Database.Database) =>
  sqlite.prepare('SELECT * FROM project_setting_overrides ORDER BY workspace_id, key').all();

it('migrates schema 17 Project overrides intact, then stores and cascades a pinned Theme', () => {
  const path = join(directory, 'library.sqlite');
  const projectId = '00000000-0000-4000-8000-000000000501';
  let repository = createTestProjectRepository(path);
  let application = new ProjectApplication(repository);
  application.createProject({ projectId, name: 'Pinned', referenceKey: 'PIN' });
  application.updateProjectSettingOverride(projectId, { key: 'minimapVisible', value: false });
  application.updateProjectSettingOverride('default', {
    key: 'handleOrientation',
    value: 'vertical'
  });
  repository.close();

  // Restore the schema-17 table, whose CHECK constraint predates Project Themes.
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE legacy_overrides (
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
    INSERT INTO legacy_overrides SELECT * FROM project_setting_overrides;
    DROP TABLE project_setting_overrides;
    ALTER TABLE legacy_overrides RENAME TO project_setting_overrides;
    CREATE INDEX project_setting_overrides_workspace_id_idx
    ON project_setting_overrides(workspace_id);
  `);
  legacy.pragma('user_version = 17');
  const rows = overrideRows(legacy);
  expect(() =>
    legacy
      .prepare(
        `INSERT INTO project_setting_overrides VALUES ('${projectId}', 'theme', '"paper"', 'now')`
      )
      .run()
  ).toThrow();
  legacy.close();

  repository = new ProjectRepository(path, { opening: 'existing' });
  expect(repository.readiness()).toEqual({ schemaVersion: LATEST_SCHEMA_VERSION });
  application = new ProjectApplication(repository);
  application.updateProjectSettingOverride(projectId, { key: 'theme', value: 'paper' });
  expect(application.queryProjectSettings(projectId)).toMatchObject({
    effectiveValues: { minimapVisible: false, theme: 'paper' },
    sources: { minimapVisible: 'project', theme: 'project' }
  });
  repository.close();

  const migrated = new Database(path);
  expect(overrideRows(migrated).filter((row) => !JSON.stringify(row).includes('theme'))).toEqual(
    rows
  );
  expect(migrated.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(migrated.pragma('foreign_key_check')).toEqual([]);
  expect(
    migrated
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('project_setting_overrides_workspace_id_idx')
  ).toBeDefined();
  migrated.pragma('foreign_keys = ON');
  migrated.prepare('DELETE FROM workspaces WHERE id = ?').run(projectId);
  expect(
    migrated
      .prepare('SELECT COUNT(*) AS count FROM project_setting_overrides WHERE workspace_id = ?')
      .get(projectId)
  ).toEqual({ count: 0 });
  migrated.close();
});
