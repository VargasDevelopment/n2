import { ProjectApplication } from '@n2/application';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

const agent = { kind: 'agent', name: 'example-lead' } as const;
const taskId = '00000000-0000-4000-8000-000000000301';

describe('Project Activity persistence', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-activity-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('records who issued each command and folds an agent run into net changes', () => {
    const repository = createTestProjectRepository(join(directory, 'activity.sqlite'));
    const application = new ProjectApplication(repository);
    application.executeCommand(
      'default',
      {
        kind: 'create_node',
        commandId: '00000000-0000-4000-8000-000000000311',
        nodeId: taskId,
        input: { kind: 'task', title: 'Draft', position: { x: 0, y: 0 } }
      },
      { kind: 'person' }
    );
    const seen = application.markActivitySeen('default', 1);
    for (const [index, patch] of [
      { title: 'Second draft' },
      { description: 'v1' },
      { description: 'v2' },
      { position: { x: 40, y: 0 } },
      { requestedStatus: 'in_progress' as const },
      { title: 'Final draft' }
    ].entries()) {
      application.executeCommand(
        'default',
        {
          kind: 'update_node',
          commandId: `00000000-0000-4000-8000-00000000032${index}`,
          nodeId: taskId,
          expectedVersion: index,
          patch
        },
        agent
      );
    }

    expect(
      repository
        .getActivityHistory('default')
        .receipts.map(({ sequence, actor }) => [sequence, actor])
    ).toEqual([
      [1, { kind: 'person' }],
      ...[2, 3, 4, 5, 6, 7].map((sequence) => [sequence, agent])
    ]);
    const activity = application.queryActivity('default');
    expect(activity).toMatchObject({ latestSequence: 7, seen, unseenItemCount: 1 });
    expect(activity.runs.map(({ actor, firstSequence }) => [actor, firstSequence])).toEqual([
      [agent, 2],
      [{ kind: 'person' }, 1]
    ]);
    expect(activity.runs[0]?.entries).toMatchObject([
      {
        subject: { id: taskId, title: 'Final draft', present: true },
        // The position-only update is layout, so it neither counts nor appears.
        commandCount: 5,
        changes: [
          { kind: 'renamed', from: 'Draft', to: 'Final draft' },
          { kind: 'status_requested', from: 'ready', to: 'in_progress' },
          { kind: 'text_edited', edits: 2 }
        ]
      }
    ]);
    repository.close();
  });

  it('only moves the Seen Marker forward and never past the latest receipt', () => {
    const repository = createTestProjectRepository(join(directory, 'marker.sqlite'));
    const application = new ProjectApplication(repository);
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000331',
      nodeId: taskId,
      input: { kind: 'task', title: 'Draft', position: { x: 0, y: 0 } }
    });

    expect(application.markActivitySeen('default', 99).sequence).toBe(1);
    expect(application.markActivitySeen('default', 0).sequence).toBe(1);
    expect(application.queryActivity('default').unseenItemCount).toBe(0);
    repository.close();
  });

  it('tells a client the newest command each graph reflects, so it can tell when it is behind', () => {
    const repository = createTestProjectRepository(join(directory, 'reflects.sqlite'));
    const application = new ProjectApplication(repository);
    const before = application.queryProject('default').latestSequence;
    const created = application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000341',
      nodeId: taskId,
      input: { kind: 'task', title: 'Draft', position: { x: 0, y: 0 } }
    });
    const renamed = application.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000342',
      nodeId: taskId,
      expectedVersion: 0,
      patch: { title: 'Final' }
    });
    // A status change answers with the projection taken inside its own write; a retry replays it.
    const statusChange = {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000343',
      nodeId: taskId,
      expectedVersion: 1,
      patch: { requestedStatus: 'done' }
    } as const;
    const completed = application.executeCommand('default', statusChange);
    const replayed = application.executeCommand('default', statusChange);

    expect(
      [created, renamed, completed, replayed].map(({ project }) => project.latestSequence - before)
    ).toEqual([1, 2, 3, 3]);
    expect(application.queryProject('default').latestSequence).toBe(
      application.queryActivity('default').latestSequence
    );
    repository.close();
  });

  it('keeps a deleted item’s Reference so its activity can still name it', () => {
    const repository = createTestProjectRepository(join(directory, 'deleted.sqlite'));
    const application = new ProjectApplication(repository);
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000361',
      nodeId: taskId,
      input: { kind: 'task', title: 'Spike', position: { x: 0, y: 0 } }
    });
    // Seen in between: created and deleted inside one run would be no net change.
    application.markActivitySeen('default', application.queryActivity('default').latestSequence);
    application.executeCommand('default', {
      kind: 'delete_node',
      commandId: '00000000-0000-4000-8000-000000000362',
      nodeId: taskId,
      expectedVersion: 0
    });

    expect(application.queryActivity('default').runs[0]?.entries[0]?.subject).toEqual({
      id: taskId,
      reference: 'N2-5',
      title: 'Spike',
      kind: 'task',
      present: false
    });
    repository.close();
  });

  it('numbers existing receipts in commit order and starts every Project caught up', () => {
    const databasePath = join(directory, 'legacy.sqlite');
    let repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    for (const [index, title] of ['One', 'Two', 'Three'].entries()) {
      application.executeCommand('default', {
        kind: 'create_node',
        commandId: `00000000-0000-4000-8000-00000000034${index}`,
        nodeId: `00000000-0000-4000-8000-00000000035${index}`,
        input: { kind: 'task', title, position: { x: 0, y: 0 } }
      });
    }
    repository.close();
    // Restore the version 15 shape: no sequence, actor, kept Reference, or Seen Markers.
    const version15 = new Database(databasePath);
    version15.exec(`
      DROP INDEX command_receipts_project_sequence;
      ALTER TABLE command_receipts DROP COLUMN sequence;
      ALTER TABLE command_receipts DROP COLUMN actor_kind;
      ALTER TABLE command_receipts DROP COLUMN actor_name;
      ALTER TABLE entity_id_reservations DROP COLUMN reference;
      DROP TABLE activity_seen_markers;
    `);
    version15.pragma('user_version = 15');
    version15.close();

    repository = new ProjectRepository(databasePath);
    const receipts = repository.getActivityHistory('default').receipts;
    expect(
      receipts.map(({ sequence, actor, itemReference }) => [sequence, actor, itemReference])
    ).toEqual([
      [1, null, 'N2-5'],
      [2, null, 'N2-6'],
      [3, null, 'N2-7']
    ]);
    expect(receipts.map(({ fingerprint }) => fingerprint)).toEqual([
      expect.stringContaining('"title":"One"'),
      expect.stringContaining('"title":"Two"'),
      expect.stringContaining('"title":"Three"')
    ]);
    expect(repository.getSeenMarker('default')).toMatchObject({ sequence: 3 });
    expect(new ProjectApplication(repository).queryActivity('default').unseenItemCount).toBe(0);
    repository.close();
    const sqlite = new Database(databasePath, { readonly: true });
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    sqlite.close();
  });
});
