import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectRepository } from '../../src/index.js';
import { LATEST_SCHEMA_VERSION } from '../../src/schemaMigrations.js';
import { createTestProjectRepository } from './projectDatabase.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'n2-test-fixture-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

it('creates the production schema and starter data with real WAL storage', () => {
  vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
  const path = join(directory, 'fixture.sqlite');
  const fixture = createTestProjectRepository(path);
  const productionPath = join(directory, 'production.sqlite');
  const production = new ProjectRepository(productionPath);
  try {
    expect(fixture.readiness()).toEqual({ schemaVersion: LATEST_SCHEMA_VERSION });
    expect(fixture.getProject('default')).toEqual(production.getProject('default'));
    const database = new Database(path);
    const original = new Database(productionPath);
    try {
      const schema = 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name';
      expect(database.prepare(schema).all()).toEqual(original.prepare(schema).all());
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
      original.close();
    }
  } finally {
    fixture.close();
    production.close();
  }
});

it('keeps mutations out of subsequent copies and persists them when reopened', () => {
  const path = join(directory, 'first.sqlite');
  const first = createTestProjectRepository(path);
  try {
    first.renameProject('default', 'Changed');
  } finally {
    first.close();
  }
  const second = createTestProjectRepository(join(directory, 'second.sqlite'));
  const reopened = new ProjectRepository(path);
  try {
    expect(second.getProjectSummary('default').name).toBe('Starter project');
    expect(reopened.getProjectSummary('default').name).toBe('Changed');
  } finally {
    second.close();
    reopened.close();
  }
});

it('refuses to overwrite an existing database or migration fixture', () => {
  const path = join(directory, 'existing.sqlite');
  const repository = createTestProjectRepository(path);
  repository.close();
  const bytes = readFileSync(path);
  const modified = statSync(path, { bigint: true }).mtimeNs;
  expect(() => createTestProjectRepository(path)).toThrow(/EEXIST/);
  expect(readFileSync(path)).toEqual(bytes);
  expect(statSync(path, { bigint: true }).mtimeNs).toBe(modified);
});
