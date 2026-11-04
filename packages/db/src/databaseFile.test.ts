import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRepository } from './index.js';
import { createTestProjectRepository } from '../test/fixtures/projectDatabase.js';
import { LATEST_SCHEMA_VERSION } from './schemaMigrations.js';
import { createLegacyProjectDatabase } from '../test/fixtures/legacyProjectDatabase.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'n2-existing-db-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('existing database policy', () => {
  it('refuses a missing database without creating it', () => {
    const path = join(directory, 'missing.sqlite');
    expect(() => new ProjectRepository(path, { opening: 'existing' })).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it('refuses empty files, directories, and symlinks without changing them', () => {
    const empty = join(directory, 'empty.sqlite');
    const folder = join(directory, 'folder');
    const link = join(directory, 'link.sqlite');
    writeFileSync(empty, '');
    mkdirSync(folder);
    symlinkSync(empty, link);
    for (const path of [empty, folder, link]) {
      expect(() => new ProjectRepository(path, { opening: 'existing' })).toThrow(/Refusing/);
    }
  });

  it('keeps development creation and allows reopening a populated database in production', () => {
    const path = join(directory, 'n2.sqlite');
    const development = new ProjectRepository(path);
    development.close();
    const production = new ProjectRepository(path, { opening: 'existing' });
    expect(production.readiness()).toEqual({ schemaVersion: LATEST_SCHEMA_VERSION });
    production.close();
    expect(() => production.readiness()).toThrow();
  });

  it.each([0, 1, LATEST_SCHEMA_VERSION])(
    'refuses an unrelated SQLite database at version %i without changing it',
    (version) => {
      const path = join(directory, 'unrelated.sqlite');
      const unrelated = new Database(path);
      unrelated.exec(
        "CREATE TABLE personal_data (value TEXT); INSERT INTO personal_data VALUES ('keep');"
      );
      unrelated.pragma(`user_version = ${version}`);
      unrelated.close();
      const bytes = readFileSync(path);
      const modified = statSync(path, { bigint: true }).mtimeNs;

      expect(() => new ProjectRepository(path, { opening: 'existing' })).toThrow(
        `Refusing authoritative N2 database at "${path}": Missing N2 core table: workspaces`
      );
      expect(readFileSync(path)).toEqual(bytes);
      expect(statSync(path, { bigint: true }).mtimeNs).toBe(modified);
      expect(readdirSync(directory)).toEqual(['unrelated.sqlite']);
    }
  );

  it('refuses a non-empty SQLite file with no tables', () => {
    const path = join(directory, 'no-schema.sqlite');
    const database = new Database(path);
    database.exec('VACUUM');
    database.close();
    expect(statSync(path).size).toBeGreaterThan(0);
    expect(() => new ProjectRepository(path, { opening: 'existing' })).toThrow(
      'Missing N2 core table: workspaces'
    );
  });

  it('requires N2 core columns even when the core table names exist', () => {
    const path = join(directory, 'wrong-columns.sqlite');
    const database = new Database(path);
    database.exec(
      'CREATE TABLE workspaces (value TEXT); CREATE TABLE nodes (id TEXT); CREATE TABLE edges (id TEXT);'
    );
    database.close();
    expect(() => new ProjectRepository(path, { opening: 'existing' })).toThrow(/no such column/);
  });

  it('accepts and migrates a genuine unversioned legacy N2 library', () => {
    const path = join(directory, 'legacy.sqlite');
    createLegacyProjectDatabase(path);
    const production = new ProjectRepository(path, { opening: 'existing' });
    try {
      expect(production.readiness()).toEqual({ schemaVersion: LATEST_SCHEMA_VERSION });
      expect(production.listProjects({ includeArchived: true })).toEqual([
        expect.objectContaining({ id: 'default', name: 'Legacy project' })
      ]);
    } finally {
      production.close();
    }
  });

  it.each([-1, LATEST_SCHEMA_VERSION + 1])(
    'refuses an unsupported N2 schema version %i before changing the file',
    (version) => {
      const path = join(directory, 'unsupported.sqlite');
      const repository = createTestProjectRepository(path);
      repository.close();
      const database = new Database(path);
      database.pragma('journal_mode = DELETE');
      database.pragma(`user_version = ${version}`);
      database.close();
      const bytes = readFileSync(path);
      const modified = statSync(path, { bigint: true }).mtimeNs;

      expect(() => new ProjectRepository(path, { opening: 'existing' })).toThrow(
        `Refusing authoritative N2 database at "${path}": Schema version ${version} is outside the supported range 0–${LATEST_SCHEMA_VERSION}`
      );
      expect(readFileSync(path)).toEqual(bytes);
      expect(statSync(path, { bigint: true }).mtimeNs).toBe(modified);
      expect(readdirSync(directory)).toEqual(['unsupported.sqlite']);
    }
  );
});

describe('create-if-missing database policy', () => {
  const open = (path: string) => new ProjectRepository(path, { opening: 'create-if-missing' });

  it('creates a missing library owner-only, then reopens it without recreating it', () => {
    const path = join(directory, 'n2.sqlite');
    const created = open(path);
    try {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(created.listProjects({ includeArchived: true })).toEqual([
        expect.objectContaining({ id: 'default' })
      ]);
      created.renameProject('default', 'Kept');
    } finally {
      created.close();
    }
    const reopened = open(path);
    try {
      expect(reopened.getProjectSummary('default').name).toBe('Kept');
    } finally {
      reopened.close();
    }
    const production = new ProjectRepository(path, { opening: 'existing' });
    production.close();
  });

  it('refuses dangling and live symlinks without following them', () => {
    const library = join(directory, 'library.sqlite');
    open(library).close();
    const missingTarget = join(directory, 'missing-target.sqlite');
    const dangling = join(directory, 'dangling.sqlite');
    const live = join(directory, 'live.sqlite');
    symlinkSync(missingTarget, dangling);
    symlinkSync(library, live);
    for (const path of [dangling, live]) expect(() => open(path)).toThrow(/Refusing/);
    expect(existsSync(missingTarget)).toBe(false);
  });

  it('refuses an existing empty file or unrelated SQLite file without changing it', () => {
    const empty = join(directory, 'empty.sqlite');
    writeFileSync(empty, '');
    const unrelated = join(directory, 'unrelated.sqlite');
    const database = new Database(unrelated);
    database.exec(
      "CREATE TABLE personal_data (value TEXT); INSERT INTO personal_data VALUES ('keep');"
    );
    database.close();
    for (const path of [empty, unrelated]) {
      const bytes = readFileSync(path);
      expect(() => open(path)).toThrow(/Refusing/);
      expect(readFileSync(path)).toEqual(bytes);
    }
  });

  it('does not create a missing parent directory', () => {
    const path = join(directory, 'absent', 'n2.sqlite');
    expect(() => open(path)).toThrow(/ENOENT/);
    expect(existsSync(join(directory, 'absent'))).toBe(false);
  });
});
