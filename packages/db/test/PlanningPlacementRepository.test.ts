import { ProjectApplication } from '@n2/application';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

it('round-trips discriminated Planning Placements and clears them without residue', () => {
  const directory = mkdtempSync(join(tmpdir(), 'n2-planning-db-'));
  const databasePath = join(directory, 'planning-placement.sqlite');
  const nodeId = '00000000-0000-4000-8000-000000000101';

  try {
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000102',
      nodeId,
      input: {
        kind: 'task',
        title: 'Same-day work',
        planningPlacement: {
          kind: 'window',
          startDate: '2026-09-10',
          endDate: '2026-09-10'
        },
        position: { x: 0, y: 0 }
      }
    });
    expect(repository.getProject().nodes.find(({ id }) => id === nodeId)).toMatchObject({
      planningPlacement: {
        kind: 'window',
        startDate: '2026-09-10',
        endDate: '2026-09-10'
      }
    });
    repository.close();

    const reopened = new ProjectRepository(databasePath);
    const reopenedApplication = new ProjectApplication(reopened);
    const milestone = reopenedApplication.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000103',
      nodeId,
      expectedVersion: 0,
      patch: { planningPlacement: { kind: 'milestone', date: '2026-09-20' } }
    });
    expect(milestone.project.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      planningPlacement: { kind: 'milestone', date: '2026-09-20' }
    });
    reopenedApplication.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000104',
      nodeId,
      expectedVersion: 1,
      patch: { planningPlacement: null }
    });
    expect(reopened.getProject().nodes.find(({ id }) => id === nodeId)).not.toHaveProperty(
      'planningPlacement'
    );
    reopened.close();

    const sqlite = new Database(databasePath);
    expect(
      sqlite
        .prepare(
          'SELECT planning_kind, planning_start_date, planning_end_date FROM nodes WHERE id = ?'
        )
        .get(nodeId)
    ).toEqual({ planning_kind: null, planning_start_date: null, planning_end_date: null });

    const corruptPlacement = sqlite.prepare(`
      UPDATE nodes
      SET planning_kind = ?, planning_start_date = ?, planning_end_date = ?
      WHERE id = ?
    `);
    for (const columns of [
      [null, '2026-09-10', null],
      ['window', '2026-09-10', null],
      ['milestone', null, null]
    ]) {
      expect(() => corruptPlacement.run(...columns, nodeId)).toThrow(
        /CHECK constraint failed: nodes_planning_shape/
      );
    }
    expect(
      sqlite
        .prepare(
          'SELECT planning_kind, planning_start_date, planning_end_date FROM nodes WHERE id = ?'
        )
        .get(nodeId)
    ).toEqual({ planning_kind: null, planning_start_date: null, planning_end_date: null });
    sqlite.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
