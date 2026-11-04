import Database from 'better-sqlite3';
import { ProjectApplication } from '@n2/application';
import { ProjectCommandSchema, type ProjectCommandInput } from '@n2/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';
import { createLegacyProjectDatabase } from './fixtures/legacyProjectDatabase.js';

type WithoutCommandId<T> = T extends { commandId: string } ? Omit<T, 'commandId'> : never;
type CommandWithoutId = WithoutCommandId<ProjectCommandInput>;

describe('ProjectRepository', () => {
  let directory: string;
  let commandSequence: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-db-'));
    commandSequence = 0;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const execute = (application: ProjectApplication, command: CommandWithoutId) =>
    application.executeCommand(
      'default',
      ProjectCommandSchema.parse({
        ...command,
        commandId: `00000000-0000-4000-8000-${String(++commandSequence).padStart(12, '0')}`
      })
    );

  it('migrates an empty database and initializes the starter project idempotently', () => {
    const databasePath = join(directory, 'new.sqlite');
    const first = new ProjectRepository(databasePath);
    expect(first.getProject().nodes).toHaveLength(4);
    first.close();

    const reservations = new Database(databasePath, { readonly: true });
    expect(
      reservations
        .prepare(
          'SELECT entity_type, COUNT(*) AS count FROM entity_id_reservations GROUP BY entity_type ORDER BY entity_type'
        )
        .all()
    ).toEqual([
      { entity_type: 'node', count: 4 },
      { entity_type: 'relationship', count: 5 }
    ]);
    reservations.close();

    const second = new ProjectRepository(databasePath);
    expect(second.getProject().nodes).toHaveLength(4);
    second.close();

    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });

  it('replays Note creation receipts written with the legacy-compatible fingerprint', () => {
    const databasePath = join(directory, 'note-retry.sqlite');
    const commandId = '00000000-0000-4000-8000-000000000121';
    const nodeId = '00000000-0000-4000-8000-000000000122';
    const firstRepository = createTestProjectRepository(databasePath);
    const first = new ProjectApplication(firstRepository).executeCommand('default', {
      kind: 'create_node',
      commandId,
      nodeId,
      input: {
        kind: 'note',
        title: 'Durable thought',
        content: '**Preserve me.**',
        position: { x: 100, y: 200 }
      }
    });
    expect(first.disposition).toBe('applied');
    firstRepository.close();

    const reopened = new ProjectRepository(databasePath);
    const replay = new ProjectApplication(reopened).executeCommand('default', {
      kind: 'create_node',
      commandId,
      nodeId,
      input: {
        kind: 'note',
        title: 'Durable thought',
        content: '**Preserve me.**',
        position: { x: 100, y: 200 }
      }
    });

    expect(replay.disposition).toBe('replayed');
    expect(replay.project.nodes.filter(({ id }) => id === nodeId)).toHaveLength(1);
    expect(replay.project.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      kind: 'note',
      content: '**Preserve me.**'
    });
    reopened.close();
  });

  it('backfills a deleted Note kind and replays both durable update fingerprint shapes', () => {
    const databasePath = join(directory, 'deleted-note-retry.sqlite');
    const nodeId = '00000000-0000-4000-8000-000000000127';
    const updateCommand = {
      kind: 'update_node' as const,
      commandId: '00000000-0000-4000-8000-000000000128',
      nodeId,
      expectedVersion: 0,
      patch: { content: '**Updated before deletion.**' }
    };
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000129',
      nodeId,
      input: {
        kind: 'note',
        title: 'Remember the kind',
        content: 'Before',
        position: { x: 0, y: 0 }
      }
    });
    application.executeCommand('default', updateCommand);
    application.executeCommand('default', {
      kind: 'delete_node',
      commandId: '00000000-0000-4000-8000-000000000130',
      nodeId,
      expectedVersion: 1
    });
    repository.close();

    const v7 = new Database(databasePath);
    v7.exec(`
      CREATE TABLE legacy_entity_id_reservations (
        entity_type TEXT NOT NULL CHECK (entity_type IN ('node', 'relationship')),
        entity_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
      INSERT INTO legacy_entity_id_reservations (entity_type, entity_id, created_at)
      SELECT entity_type, entity_id, created_at FROM entity_id_reservations;
      DROP TABLE entity_id_reservations;
      ALTER TABLE legacy_entity_id_reservations RENAME TO entity_id_reservations;
    `);
    v7.pragma('user_version = 7');
    v7.close();

    const reopened = new ProjectRepository(databasePath);
    const replay = new ProjectApplication(reopened).executeCommand('default', updateCommand);
    expect(replay.disposition).toBe('replayed');
    expect(replay.project.nodes.some(({ id }) => id === nodeId)).toBe(false);
    reopened.close();

    const sqlite = new Database(databasePath);
    expect(
      sqlite
        .prepare(
          'SELECT node_kind FROM entity_id_reservations WHERE entity_type = ? AND entity_id = ?'
        )
        .get('node', nodeId)
    ).toEqual({ node_kind: 'note' });
    const receipt = sqlite
      .prepare('SELECT fingerprint FROM command_receipts WHERE command_id = ?')
      .get(updateCommand.commandId) as { fingerprint: string };
    const fingerprint = JSON.parse(receipt.fingerprint) as unknown;
    expect(fingerprint).toMatchObject({
      patch: { content: '**Updated before deletion.**' }
    });
    expect(fingerprint).not.toHaveProperty('patch.description');

    const legacyFingerprint = JSON.parse(receipt.fingerprint) as {
      patch: { content?: string; description?: string };
    };
    const legacyContent = legacyFingerprint.patch.content;
    if (legacyContent === undefined) throw new Error('Expected a content fingerprint.');
    legacyFingerprint.patch.description = legacyContent;
    delete legacyFingerprint.patch.content;
    sqlite
      .prepare('UPDATE command_receipts SET fingerprint = ? WHERE command_id = ?')
      .run(JSON.stringify(legacyFingerprint), updateCommand.commandId);
    sqlite.close();

    const legacyReopened = new ProjectRepository(databasePath);
    const legacyReplay = new ProjectApplication(legacyReopened).executeCommand(
      'default',
      updateCommand
    );
    expect(legacyReplay.disposition).toBe('replayed');
    expect(legacyReplay.project.nodes.some(({ id }) => id === nodeId)).toBe(false);
    legacyReopened.close();
  });

  it('restores deleted entity reservations from v4 command receipts', () => {
    const databasePath = join(directory, 'v4-receipt.sqlite');
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const nodeId = 'local';
    const relationshipId = 'member-domain';
    application.executeCommand('default', {
      kind: 'delete_relationship',
      commandId: '00000000-0000-4000-8000-000000000202',
      relationshipId
    });
    application.executeCommand('default', {
      kind: 'delete_node',
      commandId: '00000000-0000-4000-8000-000000000203',
      nodeId,
      expectedVersion: 0
    });
    repository.close();

    const v4 = new Database(databasePath);
    v4.exec('DROP TABLE entity_id_reservations;');
    v4.pragma('user_version = 4');
    v4.close();

    const migrated = new ProjectRepository(databasePath);
    migrated.close();

    const reservations = new Database(databasePath, { readonly: true });
    expect(
      reservations
        .prepare(
          'SELECT entity_type, entity_id FROM entity_id_reservations WHERE entity_id IN (?, ?) ORDER BY entity_type'
        )
        .all(nodeId, relationshipId)
    ).toEqual([
      { entity_type: 'node', entity_id: nodeId },
      { entity_type: 'relationship', entity_id: relationshipId }
    ]);
    reservations.close();
  });

  it('adopts an unversioned current-schema database without rebuilding or reseeding it', () => {
    const databasePath = join(directory, 'unversioned-current.sqlite');
    const initialized = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(initialized);
    execute(application, {
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { title: 'Keep this title' }
    });
    const noteId = '00000000-0000-4000-8000-000000000125';
    execute(application, {
      kind: 'create_node',
      nodeId: noteId,
      input: {
        kind: 'note',
        title: 'Keep this note',
        content: '**Current schema content.**',
        position: { x: 30, y: 40 }
      }
    });
    initialized.close();

    const unversioned = new Database(databasePath);
    unversioned.pragma('user_version = 0');
    unversioned.close();

    const adopted = new ProjectRepository(databasePath);
    expect(adopted.getProject().nodes.find(({ id }) => id === 'local')).toMatchObject({
      title: 'Keep this title',
      version: 1
    });
    expect(adopted.getProject().nodes.find(({ id }) => id === noteId)).toMatchObject({
      kind: 'note',
      content: '**Current schema content.**'
    });
    adopted.close();

    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });

  it('enforces relationship invariants before persistence', () => {
    const repository = createTestProjectRepository(join(directory, 'invariants.sqlite'));
    const application = new ProjectApplication(repository);
    const otherGroupId = '00000000-0000-4000-8000-000000000101';
    execute(application, {
      kind: 'create_node',
      nodeId: otherGroupId,
      input: { title: 'Other group', kind: 'group', position: { x: 0, y: 0 } }
    });

    expect(() =>
      execute(application, {
        kind: 'create_relationship',
        relationshipId: '00000000-0000-4000-8000-000000000102',
        input: { kind: 'member_of', memberId: 'agent', groupId: 'local' }
      })
    ).toThrowError(expect.objectContaining({ violation: 'group_required' }));
    execute(application, {
      kind: 'create_relationship',
      relationshipId: '00000000-0000-4000-8000-000000000103',
      input: { kind: 'member_of', memberId: 'local', groupId: otherGroupId }
    });
    expect(() =>
      execute(application, {
        kind: 'create_relationship',
        relationshipId: '00000000-0000-4000-8000-000000000104',
        input: { kind: 'depends_on', dependentId: 'domain', dependencyId: 'agent' }
      })
    ).toThrowError(expect.objectContaining({ violation: 'cycle' }));

    expect(repository.getProject().relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'member-local',
          kind: 'member_of',
          memberId: 'local',
          groupId: 'n2-group'
        }),
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000103',
          kind: 'member_of',
          memberId: 'local',
          groupId: otherGroupId
        })
      ])
    );
    expect(repository.getProject().relationships).toHaveLength(6);
    repository.close();
  });

  it('migrates legacy notes into standalone annotations and quarantines their edges', () => {
    const databasePath = join(directory, 'v5-note.sqlite');
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const noteId = '00000000-0000-4000-8000-000000000111';
    const edgeId = '00000000-0000-4000-8000-000000000112';
    const missingEdgeId = '00000000-0000-4000-8000-000000000113';
    execute(application, {
      kind: 'create_node',
      nodeId: noteId,
      input: {
        kind: 'note',
        title: 'Legacy note',
        content: '**Keep this context.**',
        position: { x: 20, y: 40 }
      }
    });
    repository.close();

    const v5 = new Database(databasePath);
    v5.pragma('foreign_keys = OFF');
    v5.exec(`
      CREATE TABLE legacy_nodes (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK (kind IN ('task', 'group', 'note')),
        requested_status TEXT NOT NULL CHECK (
          requested_status IN ('ready', 'in_progress', 'blocked', 'done')
        ),
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO legacy_nodes
      SELECT id, workspace_id, title, COALESCE(content, description, ''), kind,
             COALESCE(requested_status, 'ready'), position_x, position_y,
             version, created_at, updated_at
      FROM nodes;
      DROP TABLE nodes;
      ALTER TABLE legacy_nodes RENAME TO nodes;
      CREATE INDEX nodes_workspace_id_idx ON nodes(workspace_id);

      CREATE TABLE legacy_relationship_quarantines (
        relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        violation TEXT NOT NULL CHECK (violation IN (
          'self_relationship', 'missing_node', 'duplicate_relationship',
          'group_required', 'multiple_memberships', 'cycle'
        )),
        message TEXT NOT NULL
      );
      INSERT INTO legacy_relationship_quarantines
      SELECT relationship_id, workspace_id, violation, message
      FROM relationship_quarantines;
      DROP TABLE relationship_quarantines;
      ALTER TABLE legacy_relationship_quarantines RENAME TO relationship_quarantines;
      CREATE INDEX relationship_quarantines_workspace_id_idx
      ON relationship_quarantines(workspace_id);

      INSERT INTO edges (id, workspace_id, source, target, kind, created_at)
      VALUES (
        '${edgeId}', 'default', '${noteId}', 'local', 'depends_on',
        '2026-08-23T12:00:00.000Z'
      );
      INSERT INTO edges (id, workspace_id, source, target, kind, created_at)
      VALUES (
        '${missingEdgeId}', 'default', 'missing-work-node', 'local', 'depends_on',
        '2026-08-23T12:00:00.000Z'
      );
      INSERT INTO relationship_quarantines (
        relationship_id, workspace_id, violation, message
      ) VALUES (
        '${edgeId}', 'default', 'group_required',
        'A node can only be part of a group.'
      ), (
        '${missingEdgeId}', 'default', 'missing_node',
        'The relationship references a missing node.'
      );
      UPDATE relationship_quarantines
      SET rowid = 99
      WHERE relationship_id = '${missingEdgeId}';
    `);
    v5.pragma('user_version = 5');
    v5.close();

    const migrated = new ProjectRepository(databasePath);
    expect(migrated.getProject().nodes.find(({ id }) => id === noteId)).toEqual(
      expect.objectContaining({
        kind: 'note',
        title: 'Legacy note',
        content: '**Keep this context.**'
      })
    );
    expect(migrated.getProject().nodes.find(({ id }) => id === noteId)).not.toHaveProperty(
      'requestedStatus'
    );
    expect(migrated.getProject().relationships.some(({ id }) => id === edgeId)).toBe(false);
    expect(migrated.getRelationshipWarnings()).toContainEqual(
      expect.objectContaining({
        relationshipId: edgeId,
        violation: 'work_node_required'
      })
    );
    expect(migrated.getRelationshipWarnings()).toContainEqual(
      expect.objectContaining({
        relationshipId: missingEdgeId,
        violation: 'missing_node'
      })
    );
    migrated.close();

    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite
        .prepare('SELECT description, content, requested_status FROM nodes WHERE id = ?')
        .get(noteId)
    ).toEqual({
      description: null,
      content: '**Keep this context.**',
      requested_status: null
    });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });

  it('deletes a node and its incident relationships in one database statement', () => {
    const repository = createTestProjectRepository(join(directory, 'delete.sqlite'));
    execute(new ProjectApplication(repository), {
      kind: 'delete_node',
      nodeId: 'local',
      expectedVersion: 0
    });

    const project = repository.getProject();
    expect(project.nodes.some(({ id }) => id === 'local')).toBe(false);
    expect(
      project.relationships.some((relationship) =>
        relationship.kind === 'member_of'
          ? relationship.memberId === 'local' || relationship.groupId === 'local'
          : relationship.dependentId === 'local' || relationship.dependencyId === 'local'
      )
    ).toBe(false);
    repository.close();
  });

  it('moves a node cohort atomically when every expected version matches', () => {
    const repository = createTestProjectRepository(join(directory, 'move-nodes.sqlite'));
    const application = new ProjectApplication(repository);

    execute(application, {
      kind: 'move_nodes',
      moves: {
        domain: { position: { x: 700, y: 100 }, expectedVersion: 0 },
        local: { position: { x: 700, y: 300 }, expectedVersion: 0 }
      }
    });

    expect(repository.getProject().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'domain', position: { x: 700, y: 100 }, version: 1 }),
        expect.objectContaining({ id: 'local', position: { x: 700, y: 300 }, version: 1 })
      ])
    );
    repository.close();
  });

  it('rolls back every node move when any expected version conflicts', () => {
    const repository = createTestProjectRepository(join(directory, 'move-nodes-conflict.sqlite'));
    const application = new ProjectApplication(repository);
    const before = repository.getProject();

    expect(() =>
      execute(application, {
        kind: 'move_nodes',
        moves: {
          domain: { position: { x: 700, y: 100 }, expectedVersion: 0 },
          local: { position: { x: 700, y: 300 }, expectedVersion: 99 }
        }
      })
    ).toThrowError(expect.objectContaining({ currentVersion: 0 }));

    expect(repository.getProject()).toEqual(before);
    repository.close();
  });

  it('deletes only the requested relationship and preserves its endpoint nodes', () => {
    const repository = createTestProjectRepository(join(directory, 'delete-relationship.sqlite'));
    const application = new ProjectApplication(repository);

    expect(() =>
      application.executeCommand('missing', {
        kind: 'delete_relationship',
        commandId: '00000000-0000-4000-8000-000000000201',
        relationshipId: 'local-before-agent'
      })
    ).toThrowError('Project missing does not exist.');
    expect(
      repository.getProject().relationships.some(({ id }) => id === 'local-before-agent')
    ).toBe(true);

    execute(application, { kind: 'delete_relationship', relationshipId: 'local-before-agent' });

    const project = repository.getProject();
    expect(project.relationships).toHaveLength(4);
    expect(project.relationships.some(({ id }) => id === 'local-before-agent')).toBe(false);
    expect(project.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining(['local', 'agent']));
    expect(() =>
      execute(application, { kind: 'delete_relationship', relationshipId: 'local-before-agent' })
    ).toThrowError('Relationship local-before-agent does not exist in this project.');
    repository.close();
  });

  it('reactivates valid legacy overlaps while other quarantined rows remain inert', () => {
    const databasePath = join(directory, 'legacy.sqlite');
    createLegacyProjectDatabase(databasePath);

    const repository = new ProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const migrated = repository.getProject();
    const projected = application.queryProject('default');
    const migratedWarnings = repository.getRelationshipWarnings();
    const replacementId = '00000000-0000-4000-8000-000000000301';
    execute(application, {
      kind: 'create_relationship',
      relationshipId: replacementId,
      input: { kind: 'member_of', memberId: 'dependent', groupId: 'group' }
    });
    const repaired = repository.getProject();
    const repairedWarnings = repository.getRelationshipWarnings();
    repository.close();

    expect(migrated.nodes).toHaveLength(4);
    expect(migrated.nodes.every((node) => node.kind === 'note' || node.description === '')).toBe(
      true
    );
    expect(migrated.relationships).toHaveLength(3);
    expect(migrated.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'membership',
          kind: 'member_of',
          memberId: 'dependency',
          groupId: 'group'
        }),
        expect.objectContaining({
          id: 'second-membership',
          kind: 'member_of',
          memberId: 'dependency',
          groupId: 'other-group'
        }),
        expect.objectContaining({
          id: 'dependency',
          kind: 'depends_on',
          dependentId: 'dependent',
          dependencyId: 'dependency'
        })
      ])
    );
    expect(projected.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'group',
          effectiveStatus: 'blocked',
          blockedBy: ['dependency']
        }),
        expect.objectContaining({
          id: 'other-group',
          effectiveStatus: 'blocked',
          blockedBy: ['dependency']
        })
      ])
    );
    expect(migratedWarnings).toEqual([
      expect.objectContaining({
        kind: 'invalid_relationship',
        relationshipId: 'invalid-group',
        violation: 'group_required'
      })
    ]);
    expect(repaired.relationships.find(({ id }) => id === replacementId)).toMatchObject({
      kind: 'member_of',
      memberId: 'dependent',
      groupId: 'group'
    });
    expect(repaired.relationships).toHaveLength(4);
    expect(repairedWarnings).toEqual(migratedWarnings);

    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM edges').get()).toEqual({ count: 5 });
    sqlite.close();
  });

  it('deletes a reactivated legacy overlap while preserving its endpoint nodes', () => {
    const databasePath = join(directory, 'legacy-repair.sqlite');
    createLegacyProjectDatabase(databasePath);

    const repository = new ProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    expect(repository.getProject().relationships).toContainEqual(
      expect.objectContaining({ id: 'second-membership', kind: 'member_of' })
    );

    execute(application, { kind: 'delete_relationship', relationshipId: 'second-membership' });

    const repaired = repository.getProject();
    expect(
      repository
        .getRelationshipWarnings()
        .some(({ relationshipId }) => relationshipId === 'second-membership')
    ).toBe(false);
    expect(repaired.nodes.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['other-group', 'dependency'])
    );
    repository.close();

    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite.prepare('SELECT id FROM edges WHERE id = ?').get('second-membership')
    ).toBeUndefined();
    sqlite.close();
  });

  it('keeps a formerly cardinality-quarantined membership inert when it would create a cycle', () => {
    const databasePath = join(directory, 'legacy-overlap-cycle.sqlite');
    const first = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(first);
    const groupA = '00000000-0000-4000-8000-000000000401';
    const groupB = '00000000-0000-4000-8000-000000000402';
    const groupC = '00000000-0000-4000-8000-000000000403';
    for (const [nodeId, title] of [
      [groupA, 'Group A'],
      [groupB, 'Group B'],
      [groupC, 'Group C']
    ] as const) {
      execute(application, {
        kind: 'create_node',
        nodeId,
        input: { title, kind: 'group', position: { x: 0, y: 0 } }
      });
    }
    execute(application, {
      kind: 'create_relationship',
      relationshipId: '00000000-0000-4000-8000-000000000404',
      input: { kind: 'member_of', memberId: groupA, groupId: groupC }
    });
    execute(application, {
      kind: 'create_relationship',
      relationshipId: '00000000-0000-4000-8000-000000000405',
      input: { kind: 'member_of', memberId: groupB, groupId: groupA }
    });
    first.close();

    const candidateId = '00000000-0000-4000-8000-000000000406';
    const v8 = new Database(databasePath);
    v8.pragma('foreign_keys = OFF');
    v8.exec(`
      DROP TABLE relationship_quarantines;
      CREATE TABLE relationship_quarantines (
        relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        violation TEXT NOT NULL CHECK (violation IN (
          'self_relationship', 'missing_node', 'duplicate_relationship',
          'work_node_required', 'group_required', 'multiple_memberships', 'cycle'
        )),
        message TEXT NOT NULL
      );
      CREATE INDEX relationship_quarantines_workspace_id_idx
      ON relationship_quarantines(workspace_id);
      INSERT INTO entity_id_reservations (entity_type, entity_id, node_kind, created_at)
      VALUES ('relationship', '${candidateId}', NULL, '2026-08-24T00:00:00.000Z');
      INSERT INTO edges (id, workspace_id, source, target, kind, created_at)
      VALUES (
        '${candidateId}', 'default', '${groupA}', '${groupB}', 'member_of',
        '2026-08-24T00:00:00.000Z'
      );
      INSERT INTO relationship_quarantines (
        relationship_id, workspace_id, violation, message
      ) VALUES (
        '${candidateId}', 'default', 'multiple_memberships',
        'A node can be part of only one group.'
      );
    `);
    v8.pragma('user_version = 8');
    v8.close();

    const migrated = new ProjectRepository(databasePath);
    expect(migrated.getProject().relationships.some(({ id }) => id === candidateId)).toBe(false);
    expect(migrated.getRelationshipWarnings()).toContainEqual(
      expect.objectContaining({ relationshipId: candidateId, violation: 'cycle' })
    );
    migrated.close();

    const sqlite = new Database(databasePath, { readonly: true });
    const quarantineTable = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('relationship_quarantines') as { sql: string };
    expect(quarantineTable.sql).not.toContain('multiple_memberships');
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });
});
