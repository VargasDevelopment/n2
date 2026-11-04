import { ProjectApplication } from '@n2/application';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

describe('Settings persistence', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-settings-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('resolves product defaults, Application Preferences, and explicit Project overrides', () => {
    const repository = createTestProjectRepository(join(directory, 'resolution.sqlite'));
    const application = new ProjectApplication(repository);

    expect(application.queryApplicationPreferences()).toEqual({
      values: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      storedValues: {}
    });
    expect(application.queryProjectSettings('default')).toEqual({
      projectId: 'default',
      effectiveValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      applicationValues: {
        handleOrientation: 'horizontal',
        minimapVisible: true,
        theme: 'midnight'
      },
      sources: {
        handleOrientation: 'application',
        minimapVisible: 'application',
        theme: 'application'
      },
      overrides: {}
    });

    application.updateApplicationPreference({ key: 'handleOrientation', value: 'vertical' });
    application.updateProjectSettingOverride('default', {
      key: 'handleOrientation',
      value: 'vertical'
    });
    application.updateApplicationPreference({ key: 'handleOrientation', value: 'horizontal' });

    expect(application.queryProjectSettings('default')).toMatchObject({
      effectiveValues: { handleOrientation: 'vertical', minimapVisible: true },
      applicationValues: { handleOrientation: 'horizontal', minimapVisible: true },
      sources: { handleOrientation: 'project', minimapVisible: 'application' },
      overrides: { handleOrientation: 'vertical' }
    });

    application.clearProjectSettingOverride('default', 'handleOrientation');
    application.updateApplicationPreference({ key: 'minimapVisible', value: false });
    expect(application.queryProjectSettings('default')).toMatchObject({
      effectiveValues: { handleOrientation: 'horizontal', minimapVisible: false },
      sources: { handleOrientation: 'application', minimapVisible: 'application' },
      overrides: {}
    });

    application.restoreApplicationPreference('minimapVisible');
    expect(application.queryApplicationPreferences().values.minimapVisible).toBe(true);
    expect(() => application.queryProjectSettings('missing')).toThrow(/does not exist/);
    repository.close();
  });

  it('persists settings across restart and keeps Project creation retries stable', () => {
    const databasePath = join(directory, 'restart.sqlite');
    const projectId = '00000000-0000-4000-8000-000000000401';
    const input = {
      projectId,
      name: 'Configured Project',
      referenceKey: 'CONFIG',
      settings: {
        handleOrientation: 'vertical' as const,
        minimapVisible: false,
        theme: 'ember' as const
      }
    };
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);

    expect(application.createProject(input).disposition).toBe('created');
    application.updateApplicationPreference({ key: 'handleOrientation', value: 'vertical' });
    application.updateProjectSettingOverride(projectId, {
      key: 'handleOrientation',
      value: 'horizontal'
    });
    repository.close();

    const reopened = new ProjectRepository(databasePath);
    const reopenedApplication = new ProjectApplication(reopened);
    expect(reopenedApplication.queryApplicationPreferences().values.handleOrientation).toBe(
      'vertical'
    );
    expect(reopenedApplication.queryProjectSettings(projectId)).toMatchObject({
      effectiveValues: { handleOrientation: 'horizontal', minimapVisible: false, theme: 'ember' },
      sources: { handleOrientation: 'project', minimapVisible: 'project', theme: 'project' }
    });

    // Retry identity is based on creation intent, not settings that may have changed afterward.
    expect(reopenedApplication.createProject(input).disposition).toBe('existing');
    expect(() =>
      reopenedApplication.createProject({
        ...input,
        settings: { handleOrientation: 'horizontal', minimapVisible: false }
      })
    ).toThrowError(expect.objectContaining({ field: 'initialSettings', value: projectId }));
    expect(() =>
      reopenedApplication.createProject({
        ...input,
        settings: { ...input.settings, theme: 'paper' }
      })
    ).toThrowError(expect.objectContaining({ field: 'initialSettings', value: projectId }));
    reopened.close();
  });

  it('rolls back Project identity and overrides when an initial setting cannot be stored', () => {
    const databasePath = join(directory, 'atomic.sqlite');
    const migrated = createTestProjectRepository(databasePath);
    migrated.close();

    const sqlite = new Database(databasePath);
    sqlite.exec(`
      CREATE TRIGGER reject_initial_settings
      BEFORE INSERT ON project_setting_overrides
      BEGIN
        SELECT RAISE(ABORT, 'simulated settings failure');
      END;
    `);
    sqlite.close();

    const repository = new ProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const projectId = '00000000-0000-4000-8000-000000000402';
    expect(() =>
      application.createProject({
        projectId,
        name: 'Must roll back',
        referenceKey: 'ROLLBACK',
        settings: { minimapVisible: false }
      })
    ).toThrow(/simulated settings failure/);
    expect(application.queryProjectLibrary().projects).not.toContainEqual(
      expect.objectContaining({ id: projectId })
    );
    repository.close();
  });

  it('enforces the closed setting registry at the SQLite boundary', () => {
    const databasePath = join(directory, 'constraints.sqlite');
    const repository = createTestProjectRepository(databasePath);
    repository.close();
    const sqlite = new Database(databasePath);
    const insert = sqlite.prepare(
      'INSERT INTO application_preferences (key, value, updated_at) VALUES (?, ?, ?)'
    );
    expect(() => insert.run('fontSize', '14', new Date().toISOString())).toThrow();
    expect(() => insert.run('minimapVisible', '"false"', new Date().toISOString())).toThrow();
    expect(() => insert.run('theme', '"neon"', new Date().toISOString())).toThrow();
    expect(() => insert.run('theme', '"paper"', new Date().toISOString())).not.toThrow();
    const override = sqlite.prepare(
      "INSERT INTO project_setting_overrides (workspace_id, key, value, updated_at) VALUES ('default', ?, ?, ?)"
    );
    expect(() => override.run('fontSize', '14', new Date().toISOString())).toThrow();
    expect(() => override.run('theme', '"neon"', new Date().toISOString())).toThrow();
    expect(() => override.run('theme', '"system"', new Date().toISOString())).not.toThrow();
    sqlite.close();
  });

  it('migrates version 14 Application Preferences intact and then stores a Theme', () => {
    const databasePath = join(directory, 'theme-migration.sqlite');
    let repository = createTestProjectRepository(databasePath);
    new ProjectApplication(repository).updateApplicationPreference({
      key: 'handleOrientation',
      value: 'vertical'
    });
    repository.close();
    // Restore the version 14 table, whose CHECK constraint predates Theme.
    const version14 = new Database(databasePath);
    version14.exec(`
      CREATE TABLE legacy_preferences (
        key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('handleOrientation', 'minimapVisible')),
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO legacy_preferences SELECT key, value, updated_at FROM application_preferences;
      DROP TABLE application_preferences;
      ALTER TABLE legacy_preferences RENAME TO application_preferences;
    `);
    version14.pragma('user_version = 14');
    version14.close();

    repository = new ProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    expect(application.queryApplicationPreferences().storedValues).toEqual({
      handleOrientation: 'vertical'
    });
    application.updateApplicationPreference({ key: 'theme', value: 'paper' });
    repository.close();

    repository = new ProjectRepository(databasePath);
    expect(new ProjectApplication(repository).queryApplicationPreferences().values).toEqual({
      handleOrientation: 'vertical',
      minimapVisible: true,
      theme: 'paper'
    });
    repository.close();
    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });
});
