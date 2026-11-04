import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backupDatabase } from './backup.js';
import { createTestProjectRepository } from '../test/fixtures/projectDatabase.js';
import { LATEST_SCHEMA_VERSION } from './schemaMigrations.js';
import { createLegacyProjectDatabase } from '../test/fixtures/legacyProjectDatabase.js';

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'n2-backup-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function createSource(path: string): Database.Database {
  const repository = createTestProjectRepository(path);
  repository.close();
  return new Database(path);
}

it('backs up committed WAL data into a private DELETE-mode snapshot and checksummed manifest', async () => {
  const path = join(directory, 'live.sqlite');
  const source = createSource(path);
  source.pragma('journal_mode = WAL');
  source.pragma('wal_autocheckpoint = 0');
  source.exec(
    "CREATE TABLE data (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO data VALUES (1, 'in WAL')"
  );
  const backups = join(directory, 'backups');
  try {
    const result = await backupDatabase(path, backups);
    const snapshot = new Database(result.backup, { readonly: true });
    try {
      expect(snapshot.prepare('SELECT * FROM data').all()).toEqual([{ id: 1, value: 'in WAL' }]);
      expect(snapshot.pragma('journal_mode', { simple: true })).toBe('delete');
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      snapshot.close();
    }
    const artifact = dirname(result.backup);
    const metadataPath = join(artifact, 'manifest.json');
    const metadata: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'));
    expect(metadata).toMatchObject({
      file_sha256: createHash('sha256').update(readFileSync(result.backup)).digest('hex'),
      integrity: {
        user_version: LATEST_SCHEMA_VERSION,
        integrity_check: ['ok'],
        foreign_key_check: [],
        dataset_sha256: result.dataset_sha256,
        tables: { data: { rows: 1 } }
      }
    });
    expect(statSync(result.backup).mode & 0o777).toBe(0o600);
    expect(statSync(metadataPath).mode & 0o777).toBe(0o600);
    expect(statSync(artifact).mode & 0o777).toBe(0o700);
    expect(readdirSync(artifact).sort()).toEqual(['manifest.json', 'n2.sqlite']);
    expect(readdirSync(backups)).toEqual([basename(artifact)]);
    expect(source.pragma('journal_mode', { simple: true })).toBe('wal');
  } finally {
    source.close();
  }
});

it('rejects invalid foreign keys without publishing a snapshot or removing earlier backups', async () => {
  const path = join(directory, 'live.sqlite');
  const source = createSource(path);
  source.exec('CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id))');
  const backups = join(directory, 'backups');
  try {
    const previous = await backupDatabase(path, backups);
    source.pragma('foreign_keys = OFF');
    source.exec('INSERT INTO child VALUES (42)');
    await expect(backupDatabase(path, backups)).rejects.toThrow(/integrity check failed/);
    expect(readdirSync(backups)).toEqual([basename(dirname(previous.backup))]);
  } finally {
    source.close();
  }
});

it('removes the entire staged artifact when publication fails and preserves earlier backups', async () => {
  const path = join(directory, 'live.sqlite');
  const source = createSource(path);
  source.exec('CREATE TABLE data(id PRIMARY KEY)');
  source.close();
  const backups = join(directory, 'backups');
  const previous = await backupDatabase(path, backups);
  const previousSnapshot = readFileSync(previous.backup);
  const previousManifest = readFileSync(join(dirname(previous.backup), 'manifest.json'));
  vi.mocked(rename).mockRejectedValueOnce(new Error('Publication failed'));

  await expect(backupDatabase(path, backups)).rejects.toThrow('Publication failed');

  expect(readdirSync(backups)).toEqual([basename(dirname(previous.backup))]);
  expect(readFileSync(previous.backup)).toEqual(previousSnapshot);
  expect(readFileSync(join(dirname(previous.backup), 'manifest.json'))).toEqual(previousManifest);
});

it('refuses a missing source without creating a database', async () => {
  await expect(
    backupDatabase(join(directory, 'missing.sqlite'), join(directory, 'backups'))
  ).rejects.toThrow();
  expect(readdirSync(directory)).toEqual([]);
});

it.each([-1, LATEST_SCHEMA_VERSION + 1])(
  'refuses unsupported schema %i before writing a snapshot or changing the source',
  async (version) => {
    const path = join(directory, 'live.sqlite');
    const source = createSource(path);
    source.pragma('journal_mode = DELETE');
    source.pragma(`user_version = ${version}`);
    source.close();
    const bytes = readFileSync(path);

    await expect(backupDatabase(path, join(directory, 'backups'))).rejects.toThrow(
      `Schema version ${version} is outside the supported range 0–${LATEST_SCHEMA_VERSION}`
    );

    expect(readFileSync(path)).toEqual(bytes);
    expect(readdirSync(directory)).toEqual(['live.sqlite']);
  }
);

it.each([0, LATEST_SCHEMA_VERSION])(
  'backs up supported schema %i without migrating the source or snapshot',
  async (version) => {
    const path = join(directory, 'live.sqlite');
    if (version === 0) {
      createLegacyProjectDatabase(path);
    } else {
      createSource(path).close();
    }
    const result = await backupDatabase(path, join(directory, 'backups'));
    for (const databasePath of [path, result.backup]) {
      const database = new Database(databasePath, { readonly: true });
      try {
        expect(database.pragma('user_version', { simple: true })).toBe(version);
      } finally {
        database.close();
      }
    }
  }
);
