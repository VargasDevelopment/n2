import { ProjectApplication } from '@n2/application';
import {
  CreateProjectResponseSchema,
  ProjectLibrarySchema,
  ProjectUpdateResponseSchema,
  ProjectedProjectSchema
} from '@n2/contracts';
import type { ProjectRepository } from '@n2/db';
import { createTestProjectRepository } from '@n2/db/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('Project Library API', () => {
  let directory: string;
  let repository: ProjectRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-server-library-'));
    repository = createTestProjectRepository(join(directory, 'n2.sqlite'));
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('lists Projects and creates a caller-identified blank Project idempotently', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const input = {
      projectId: '00000000-0000-4000-8000-000000000301',
      name: 'Garden decision',
      referenceKey: 'GARDEN'
    };

    const initial = ProjectLibrarySchema.parse(await (await app.request('/api/projects')).json());
    expect(initial.projects).toEqual([
      expect.objectContaining({ id: 'default', referenceKey: 'N2', canvasItemCount: 4 })
    ]);

    const create = () =>
      app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      });
    const created = await create();
    const replayed = await create();
    expect(created.status).toBe(201);
    expect(replayed.status).toBe(200);
    expect(CreateProjectResponseSchema.parse(await created.json())).toMatchObject({
      disposition: 'created',
      project: { id: input.projectId, referenceKey: 'GARDEN', canvasItemCount: 0 }
    });
    expect(CreateProjectResponseSchema.parse(await replayed.json()).disposition).toBe('existing');

    const project = ProjectedProjectSchema.parse(
      await (await app.request(`/api/projects/${input.projectId}`)).json()
    );
    expect(project.nodes).toEqual([]);
    expect(project.relationships).toEqual([]);
  });

  it('rejects invalid and conflicting Project creation', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const invalid = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'not-a-uuid', name: '', referenceKey: 'lower' })
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'validation_error' });

    const conflict = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: '00000000-0000-4000-8000-000000000302',
        name: 'Conflicting key',
        referenceKey: 'N2'
      })
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      code: 'project_conflict',
      error: 'Project reference key N2 is already in use.',
      details: { field: 'referenceKey', value: 'N2' }
    });
  });

  it('renames, archives, and restores a Project and hides it from the default list', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const json = { 'content-type': 'application/json' };
    const library = async (query = '') =>
      ProjectLibrarySchema.parse(await (await app.request(`/api/projects${query}`)).json());

    const renamed = await app.request('/api/projects/default', {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ name: 'Electricity Renewal 2026' })
    });
    expect(ProjectUpdateResponseSchema.parse(await renamed.json())).toMatchObject({
      disposition: 'updated',
      project: {
        name: 'Electricity Renewal 2026',
        referenceKey: 'N2',
        archivedAt: null,
        lifecycleRevision: 1
      }
    });

    const archived = await app.request('/api/projects/default/archive', { method: 'POST' });
    expect(archived.status).toBe(200);
    const archivedProject = ProjectUpdateResponseSchema.parse(await archived.json()).project;
    expect(archivedProject.archivedAt).toEqual(expect.any(String));
    expect(archivedProject.lifecycleRevision).toBe(2);
    expect((await library()).projects).toEqual([]);
    expect((await library('?include=archived')).projects).toEqual([archivedProject]);
    expect((await app.request('/api/projects?include=everything')).status).toBe(400);

    const rejected = await app.request('/api/projects/default/settings/minimapVisible', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ value: false })
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      code: 'project_archived',
      error: 'Project default is archived. Restore it before making changes.',
      details: { projectId: 'default', archivedAt: archivedProject.archivedAt }
    });
    const command = await app.request('/api/projects/default/commands', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        kind: 'create_node',
        commandId: '00000000-0000-4000-8000-000000000401',
        nodeId: '00000000-0000-4000-8000-000000000402',
        input: { kind: 'task', title: 'Late work', position: { x: 0, y: 0 } }
      })
    });
    expect(await command.json()).toMatchObject({ code: 'project_archived' });
    expect((await app.request('/api/projects/default')).status).toBe(200);

    const restored = await app.request('/api/projects/default/restore', { method: 'POST' });
    expect(ProjectUpdateResponseSchema.parse(await restored.json())).toMatchObject({
      disposition: 'updated',
      project: { archivedAt: null, lifecycleRevision: 3 }
    });
    expect((await library()).projects).toHaveLength(1);
  });

  it('rejects invalid renames and archiving a Project with a running Attempt', async () => {
    const application = new ProjectApplication(repository);
    const app = createApp(application, repository.readiness);
    const invalid = await app.request('/api/projects/default', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ', referenceKey: 'NEW' })
    });
    expect(invalid.status).toBe(400);

    const enablementId = '00000000-0000-4000-8000-000000000411';
    application.executeCommand('default', {
      kind: 'enable_task_for_agents',
      commandId: '00000000-0000-4000-8000-000000000412',
      taskId: 'local',
      enablementId
    });
    const task = application
      .queryExecution('default')
      .tasks.find(({ taskId }) => taskId === 'local');
    application.executeCommand('default', {
      kind: 'claim_task',
      commandId: '00000000-0000-4000-8000-000000000413',
      taskId: 'local',
      attemptId: '00000000-0000-4000-8000-000000000414',
      workerId: 'worker-example',
      expectedFingerprint: task!.currentFingerprint,
      expectedEnablementId: enablementId
    });
    const refused = await app.request('/api/projects/default/archive', { method: 'POST' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: 'execution_conflict',
      details: { reason: 'project_has_active_attempt', taskIds: ['local'] }
    });
  });
});
