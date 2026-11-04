import { ProjectApplication } from '@n2/application';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRepository } from '../src/index.js';
import { createTestProjectRepository } from './fixtures/projectDatabase.js';

describe('Project Library persistence', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-project-library-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates an isolated blank Project and replays identical creation intent', () => {
    const databasePath = join(directory, 'library.sqlite');
    const repository = createTestProjectRepository(databasePath);
    const application = new ProjectApplication(repository);
    const input = {
      projectId: '00000000-0000-4000-8000-000000000301',
      name: 'Garden decision',
      referenceKey: 'GARDEN'
    };

    expect(application.queryProjectLibrary()).toEqual({
      projects: [
        {
          id: 'default',
          name: 'Starter project',
          referenceKey: 'N2',
          canvasItemCount: 4,
          archivedAt: null,
          lifecycleRevision: 0
        }
      ]
    });

    expect(application.createProject(input)).toEqual({
      disposition: 'created',
      project: {
        id: input.projectId,
        name: input.name,
        referenceKey: input.referenceKey,
        canvasItemCount: 0,
        archivedAt: null,
        lifecycleRevision: 0
      }
    });
    expect(application.createProject(input)).toMatchObject({
      disposition: 'existing',
      project: { id: input.projectId, name: input.name, referenceKey: input.referenceKey }
    });
    expect(application.queryProject(input.projectId)).toMatchObject({
      id: input.projectId,
      name: input.name,
      referenceKey: input.referenceKey,
      nodes: [],
      relationships: []
    });

    application.executeCommand(input.projectId, {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000302',
      nodeId: '00000000-0000-4000-8000-000000000303',
      input: { kind: 'task', title: 'Gather plan facts', position: { x: 0, y: 0 } }
    });
    expect(application.queryProjectLibrary().projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: input.projectId, canvasItemCount: 1 })])
    );
    expect(application.queryProject(input.projectId).nodes[0]).toMatchObject({
      reference: 'GARDEN-1'
    });
    expect(application.queryProject('default').nodes).toHaveLength(4);

    repository.close();
    const reopened = new ProjectRepository(databasePath);
    expect(reopened.listProjects({ includeArchived: false })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: input.projectId, referenceKey: 'GARDEN' })
      ])
    );
    reopened.close();
  });

  it('rejects conflicting canonical IDs and reference keys without partial creation', () => {
    const repository = createTestProjectRepository(join(directory, 'conflicts.sqlite'));
    const application = new ProjectApplication(repository);
    const projectId = '00000000-0000-4000-8000-000000000311';
    application.createProject({ projectId, name: 'First', referenceKey: 'FIRST' });

    expect(() =>
      application.createProject({ projectId, name: 'Changed', referenceKey: 'FIRST' })
    ).toThrowError(expect.objectContaining({ field: 'projectId', value: projectId }));
    expect(() =>
      application.createProject({
        projectId: '00000000-0000-4000-8000-000000000312',
        name: 'Second',
        referenceKey: 'FIRST'
      })
    ).toThrowError(expect.objectContaining({ field: 'referenceKey', value: 'FIRST' }));
    expect(application.queryProjectLibrary().projects).toHaveLength(2);
    repository.close();
  });
});
