import { ProjectApplication } from '@n2/application';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';
import { createLegacyProjectDatabase } from './fixtures/legacyProjectDatabase.js';

describe('Canvas Item Reference persistence', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-references-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('allocates immutable references monotonically and never reuses a deleted number', () => {
    const databasePath = join(directory, 'references.sqlite');
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const firstId = '00000000-0000-4000-8000-000000000141';
    const secondId = '00000000-0000-4000-8000-000000000142';

    const starter = repository.getProject();
    expect(starter.referenceKey).toBe('N2');
    expect(starter.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'n2-group', reference: 'N2-1' }),
        expect.objectContaining({ id: 'domain', reference: 'N2-2' }),
        expect.objectContaining({ id: 'local', reference: 'N2-3' }),
        expect.objectContaining({ id: 'agent', reference: 'N2-4' })
      ])
    );
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000151',
      nodeId: firstId,
      input: { kind: 'task', title: 'First', position: { x: 0, y: 0 } }
    });
    expect(repository.getProject().nodes.find(({ id }) => id === firstId)).toMatchObject({
      reference: 'N2-5',
      version: 0
    });

    application.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000152',
      nodeId: firstId,
      expectedVersion: 0,
      patch: { title: 'Renamed' }
    });
    expect(repository.getProject().nodes.find(({ id }) => id === firstId)).toMatchObject({
      reference: 'N2-5',
      title: 'Renamed',
      version: 1
    });

    application.executeCommand('default', {
      kind: 'delete_node',
      commandId: '00000000-0000-4000-8000-000000000153',
      nodeId: firstId,
      expectedVersion: 1
    });
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000154',
      nodeId: secondId,
      input: { kind: 'note', title: 'Second', position: { x: 0, y: 0 } }
    });
    expect(repository.getProject().nodes.find(({ id }) => id === secondId)).toMatchObject({
      reference: 'N2-6'
    });
    repository.close();

    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite.prepare('SELECT next_canvas_item_number FROM workspaces WHERE id = ?').get('default')
    ).toEqual({ next_canvas_item_number: 7 });
    sqlite.close();
  });

  it('backfills deterministic references when migrating an existing project', () => {
    const databasePath = join(directory, 'legacy.sqlite');
    createLegacyProjectDatabase(databasePath);

    const repository = new ProjectRepository(databasePath);
    const project = repository.getProject();
    expect(project.referenceKey).toBe('N2');
    expect(project.nodes.map(({ reference }) => reference).sort()).toEqual([
      'N2-1',
      'N2-2',
      'N2-3',
      'N2-4'
    ]);
    repository.close();
  });

  it('skips references that would collide with a preserved legacy canonical ID', () => {
    const databasePath = join(directory, 'legacy-collision.sqlite');
    createLegacyProjectDatabase(databasePath);
    const legacy = new Database(databasePath);
    legacy.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      UPDATE nodes SET id = 'N2-1' WHERE id = 'dependency';
      UPDATE edges SET source = 'N2-1' WHERE source = 'dependency';
      UPDATE edges SET target = 'N2-1' WHERE target = 'dependency';
      COMMIT;
    `);
    legacy.close();

    const repository = new ProjectRepository(databasePath);
    const project = repository.getProject();
    expect(project.nodes.map(({ reference }) => reference)).not.toContain('N2-1');
    expect(project.nodes.find(({ id }) => id === 'N2-1')).toMatchObject({ reference: 'N2-2' });
    repository.close();
  });

  it('retires future reference numbers claimed by preserved legacy canonical IDs', () => {
    const databasePath = join(directory, 'legacy-future-collision.sqlite');
    createLegacyProjectDatabase(databasePath);
    const legacy = new Database(databasePath);
    legacy.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      UPDATE nodes SET id = 'N2-100' WHERE id = 'dependency';
      UPDATE edges SET source = 'N2-100' WHERE source = 'dependency';
      UPDATE edges SET target = 'N2-100' WHERE target = 'dependency';
      COMMIT;
    `);
    legacy.close();

    const repository = new ProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const nodeId = '00000000-0000-4000-8000-000000000171';
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000172',
      nodeId,
      input: { kind: 'task', title: 'After migration', position: { x: 0, y: 0 } }
    });

    expect(repository.getProject().nodes.find(({ id }) => id === nodeId)).toMatchObject({
      reference: 'N2-101'
    });
    repository.close();
  });

  it('retires reference numbers claimed by deleted canonical IDs in the reservation ledger', () => {
    const databasePath = join(directory, 'legacy-deleted-collision.sqlite');
    createLegacyProjectDatabase(databasePath);
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE command_receipts (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, command_id)
      );
      INSERT INTO command_receipts VALUES (
        'default',
        'deleted-reference-shaped-node',
        '{}',
        '{"kind":"node_deleted","nodeId":"N2-100"}',
        '2026-01-02T00:00:00.000Z'
      );
    `);
    legacy.close();

    const repository = new ProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const nodeId = '00000000-0000-4000-8000-000000000181';
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000182',
      nodeId,
      input: { kind: 'task', title: 'After deleted ID', position: { x: 0, y: 0 } }
    });

    expect(repository.getProject().nodes.find(({ id }) => id === nodeId)).toMatchObject({
      reference: 'N2-101'
    });
    repository.close();
  });

  it('rolls back failed allocations and does not allocate again when replaying a receipt', () => {
    const databasePath = join(directory, 'reference-rollback.sqlite');
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const sqlite = new Database(databasePath);
    const command = {
      kind: 'create_node' as const,
      commandId: '00000000-0000-4000-8000-000000000161',
      nodeId: '00000000-0000-4000-8000-000000000162',
      input: { kind: 'task' as const, title: 'Transactional', position: { x: 0, y: 0 } }
    };

    sqlite.exec(`
      CREATE TRIGGER abort_reference_test
      BEFORE INSERT ON nodes
      BEGIN
        SELECT RAISE(ABORT, 'forced post-allocation failure');
      END;
    `);
    expect(() => application.executeCommand('default', command)).toThrow(
      'forced post-allocation failure'
    );
    expect(
      sqlite.prepare('SELECT next_canvas_item_number FROM workspaces WHERE id = ?').get('default')
    ).toEqual({ next_canvas_item_number: 5 });

    sqlite.exec('DROP TRIGGER abort_reference_test;');
    const applied = application.executeCommand('default', command);
    const replayed = application.executeCommand('default', command);
    expect(applied.project.nodes.find(({ id }) => id === command.nodeId)).toMatchObject({
      reference: 'N2-5'
    });
    expect(replayed.disposition).toBe('replayed');
    expect(
      sqlite.prepare('SELECT next_canvas_item_number FROM workspaces WHERE id = ?').get('default')
    ).toEqual({ next_canvas_item_number: 6 });

    sqlite.close();
    repository.close();
  });
});
