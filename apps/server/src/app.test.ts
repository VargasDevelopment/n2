import { ProjectApplication } from '@n2/application';
import {
  ApiErrorSchema,
  ProjectCommandResponseSchema,
  ProjectedProjectSchema
} from '@n2/contracts';
import { ProjectRepository } from '@n2/db';
import { createTestProjectRepository } from '@n2/db/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

describe('local API', () => {
  let directory: string;
  let repository: ProjectRepository;
  let commandSequence: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'n2-api-'));
    repository = createTestProjectRepository(join(directory, 'test.sqlite'));
    commandSequence = 0;
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const nextCommandId = () =>
    `00000000-0000-4000-8000-${String(++commandSequence).padStart(12, '0')}`;

  const command = (body: Record<string, unknown>, projectId = 'default') =>
    createApp(new ProjectApplication(repository), repository.readiness).request(
      `/api/projects/${projectId}/commands`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, commandId: body.commandId ?? nextCommandId() })
      }
    );

  it('returns a validated projected project', async () => {
    const response = await createApp(
      new ProjectApplication(repository),
      repository.readiness
    ).request('/api/projects/default');
    expect(response.status).toBe(200);
    expect(ProjectedProjectSchema.parse(await response.json()).nodes).toHaveLength(4);
  });

  it('creates a caller-identified node and returns operation-specific metadata', async () => {
    const create = {
      kind: 'create_node',
      commandId: nextCommandId(),
      nodeId: '00000000-0000-4000-8000-000000000101',
      input: { title: 'Dogfood N²', kind: 'task', position: { x: 700, y: 200 } }
    };

    const response = await command(create);
    const retry = await command(create);

    expect(response.status).toBe(200);
    expect(retry.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await retry.json());
    expect(result.disposition).toBe('replayed');
    expect(result.outcome).toEqual({
      kind: 'node_created',
      nodeId: '00000000-0000-4000-8000-000000000101'
    });
    expect(
      result.project.nodes.filter(({ id }) => id === '00000000-0000-4000-8000-000000000101')
    ).toHaveLength(1);

    const collision = await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000101',
      input: { title: 'Different intent', kind: 'group', position: { x: 0, y: 0 } }
    });
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({
      code: 'entity_conflict',
      details: {
        entityType: 'node',
        entityId: '00000000-0000-4000-8000-000000000101'
      }
    });
  });

  it('rejects a reused command ID when the mutation intent changes', async () => {
    const commandId = nextCommandId();
    const first = await command({
      kind: 'create_node',
      commandId,
      nodeId: '00000000-0000-4000-8000-000000000107',
      input: { title: 'Original', kind: 'task', position: { x: 0, y: 0 } }
    });
    const collision = await command({
      kind: 'create_node',
      commandId,
      nodeId: '00000000-0000-4000-8000-000000000108',
      input: { title: 'Different', kind: 'group', position: { x: 10, y: 10 } }
    });

    expect(first.status).toBe(200);
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({
      code: 'command_conflict',
      details: { commandId }
    });
  });

  it('replays a command receipt after the local service repository restarts', async () => {
    const create = {
      kind: 'create_node',
      commandId: nextCommandId(),
      nodeId: '00000000-0000-4000-8000-000000000112',
      input: { title: 'Durable receipt', kind: 'task', position: { x: 0, y: 0 } }
    };
    const first = await command(create);
    expect(first.status).toBe(200);

    repository.close();
    repository = new ProjectRepository(join(directory, 'test.sqlite'));
    const replay = await command(create);

    expect(replay.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await replay.json());
    expect(result.disposition).toBe('replayed');
    expect(result.project.nodes.filter(({ id }) => id === create.nodeId)).toHaveLength(1);
  });

  it('permanently reserves deleted node IDs so delayed commands cannot cross generations', async () => {
    const nodeId = '00000000-0000-4000-8000-000000000109';
    await command({
      kind: 'create_node',
      nodeId,
      input: { title: 'First generation', kind: 'task', position: { x: 0, y: 0 } }
    });
    const deletion = {
      kind: 'delete_node',
      commandId: nextCommandId(),
      nodeId,
      expectedVersion: 0
    };
    await command(deletion);
    const reuse = await command({
      kind: 'create_node',
      nodeId,
      input: { title: 'Replacement generation', kind: 'task', position: { x: 20, y: 20 } }
    });
    const staleUpdate = await command({
      kind: 'update_node',
      nodeId,
      expectedVersion: 0,
      patch: { title: 'Stale update' }
    });

    const replay = await command(deletion);

    expect(reuse.status).toBe(409);
    expect(await reuse.json()).toMatchObject({ code: 'entity_conflict' });
    expect(staleUpdate.status).toBe(404);
    expect(replay.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await replay.json());
    expect(result.disposition).toBe('replayed');
    expect(result.project.nodes.some(({ id }) => id === nodeId)).toBe(false);
  });

  it('permanently reserves deleted relationship IDs against delayed deletes', async () => {
    const relationshipId = '00000000-0000-4000-8000-000000000110';
    const dependencyId = '00000000-0000-4000-8000-000000000111';
    await command({
      kind: 'create_node',
      nodeId: dependencyId,
      input: { title: 'Replacement dependency', kind: 'task', position: { x: 20, y: 20 } }
    });
    await command({
      kind: 'create_relationship',
      relationshipId,
      input: { kind: 'depends_on', dependentId: 'agent', dependencyId: 'domain' }
    });
    const deletion = {
      kind: 'delete_relationship',
      commandId: nextCommandId(),
      relationshipId
    };
    await command(deletion);
    const reuse = await command({
      kind: 'create_relationship',
      relationshipId,
      input: { kind: 'depends_on', dependentId: 'agent', dependencyId }
    });
    const staleDelete = await command({ kind: 'delete_relationship', relationshipId });

    const replay = await command(deletion);

    expect(reuse.status).toBe(409);
    expect(await reuse.json()).toMatchObject({ code: 'entity_conflict' });
    expect(staleDelete.status).toBe(404);
    expect(replay.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await replay.json());
    expect(result.disposition).toBe('replayed');
    expect(result.project.relationships.some(({ id }) => id === relationshipId)).toBe(false);
  });

  it('executes updates through the shared command document', async () => {
    const response = await command({
      kind: 'update_node',
      nodeId: 'agent',
      expectedVersion: 0,
      patch: { description: 'Operate N² without driving the canvas.' }
    });

    expect(response.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await response.json());
    expect(result.outcome).toEqual({ kind: 'node_updated', nodeId: 'agent' });
    expect(result.project.nodes.find(({ id }) => id === 'agent')).toMatchObject({
      description: 'Operate N² without driving the canvas.',
      version: 1
    });
  });

  it('updates Planning Placement through HTTP and reports the Note boundary structurally', async () => {
    const placement = {
      kind: 'window',
      startDate: '2026-09-10',
      endDate: '2026-09-10'
    } as const;
    const scheduled = await command({
      kind: 'update_node',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { planningPlacement: placement }
    });

    expect(scheduled.status).toBe(200);
    const scheduledResult = ProjectCommandResponseSchema.parse(await scheduled.json());
    expect(scheduledResult.project.nodes.find(({ id }) => id === 'local')).toMatchObject({
      planningPlacement: placement,
      version: 1
    });

    const noteId = '00000000-0000-4000-8000-000000000104';
    await command({
      kind: 'create_node',
      nodeId: noteId,
      input: { kind: 'note', title: 'No schedule', content: '', position: { x: 0, y: 0 } }
    });
    const rejected = await command({
      kind: 'update_node',
      nodeId: noteId,
      expectedVersion: 0,
      patch: { planningPlacement: null }
    });

    expect(rejected.status).toBe(409);
    expect(ApiErrorSchema.parse(await rejected.json())).toMatchObject({
      code: 'canvas_item_conflict',
      details: { itemId: noteId, itemKind: 'note', fields: ['planningPlacement'] }
    });
  });

  it('returns a machine-readable explanation for projected node state', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    await app.request('/api/projects/default/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'update_node',
        commandId: nextCommandId(),
        nodeId: 'local',
        expectedVersion: 0,
        patch: { requestedStatus: 'blocked' }
      })
    });

    const response = await app.request('/api/projects/default/nodes/n2-4/explanation');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId: 'default',
      node: { id: 'agent', reference: 'N2-4', effectiveStatus: 'blocked' },
      status: {
        basis: 'blocking_relationships',
        blockers: [{ kind: 'blocked_dependency', node: { id: 'local' } }]
      }
    });
  });

  it('returns stable validation issues at canonical command paths', async () => {
    const response = await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000102',
      input: { title: '', kind: 'task', position: { x: 'left', y: 200 } }
    });

    expect(response.status).toBe(400);
    const error = ApiErrorSchema.parse(await response.json());
    expect(error.code).toBe('validation_error');
    if (error.code !== 'validation_error') throw new Error('Expected a validation error.');
    expect(
      error.details.issues.some(
        ({ path, code }) => path.join('.') === 'input.title' && code === 'too_small'
      )
    ).toBe(true);
    expect(
      error.details.issues.some(
        ({ path, code }) => path.join('.') === 'input.position.x' && code === 'invalid_type'
      )
    ).toBe(true);
  });

  it('honors explicit canvas-item kinds when reporting union validation issues', async () => {
    const malformedNote = await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000103',
      input: { title: 'Context', kind: 'note', content: 42, position: { x: 100, y: 200 } }
    });
    const noteError = ApiErrorSchema.parse(await malformedNote.json());
    expect(noteError.code).toBe('validation_error');
    if (noteError.code !== 'validation_error') throw new Error('Expected a validation error.');
    expect(noteError.details.issues).toContainEqual(
      expect.objectContaining({ path: ['input', 'content'], code: 'invalid_type' })
    );
    expect(noteError.details.issues.some(({ path }) => path.join('.') === 'input.kind')).toBe(
      false
    );

    const malformedGroup = await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000104',
      input: { title: 'Group', kind: 'group', description: 42, position: { x: 100, y: 200 } }
    });
    const groupError = ApiErrorSchema.parse(await malformedGroup.json());
    expect(groupError.code).toBe('validation_error');
    if (groupError.code !== 'validation_error') throw new Error('Expected a validation error.');
    expect(groupError.details.issues).toContainEqual(
      expect.objectContaining({ path: ['input', 'description'], code: 'invalid_type' })
    );
    expect(groupError.details.issues.some(({ path }) => path.join('.') === 'input.kind')).toBe(
      false
    );

    const malformedLegacyNote = await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000105',
      input: { title: 'Context', kind: 'note', description: 42, position: { x: 100, y: 200 } }
    });
    const legacyNoteError = ApiErrorSchema.parse(await malformedLegacyNote.json());
    expect(legacyNoteError.code).toBe('validation_error');
    if (legacyNoteError.code !== 'validation_error') {
      throw new Error('Expected a validation error.');
    }
    expect(legacyNoteError.details.issues).toContainEqual(
      expect.objectContaining({ path: ['input', 'content'], code: 'invalid_type' })
    );
  });

  it('keeps legacy create shapes at the HTTP compatibility boundary', async () => {
    const implicitTask = await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000123',
      input: { title: 'Implicit task', position: { x: 0, y: 0 } }
    });
    expect(implicitTask.status).toBe(200);

    const commandId = nextCommandId();
    const nodeId = '00000000-0000-4000-8000-000000000124';
    const canonicalNote = await command({
      kind: 'create_node',
      commandId,
      nodeId,
      input: {
        title: 'Durable note',
        content: '**Remember me.**',
        kind: 'note',
        position: { x: 10, y: 20 }
      }
    });
    const legacyRetry = await command({
      kind: 'create_node',
      commandId,
      nodeId,
      input: {
        title: 'Durable note',
        description: '**Remember me.**',
        kind: 'note',
        position: { x: 10, y: 20 }
      }
    });

    expect(canonicalNote.status).toBe(200);
    expect(legacyRetry.status).toBe(200);
    expect(await legacyRetry.json()).toMatchObject({ disposition: 'replayed' });
  });

  it('normalizes legacy Note updates without changing Work Node description semantics', async () => {
    const nodeId = '00000000-0000-4000-8000-000000000126';
    await command({
      kind: 'create_node',
      nodeId,
      input: {
        title: 'Durable update',
        content: 'Before',
        kind: 'note',
        position: { x: 10, y: 20 }
      }
    });

    const commandId = nextCommandId();
    const legacyUpdate = await command({
      kind: 'update_node',
      commandId,
      nodeId,
      expectedVersion: 0,
      patch: { description: '**After.**' }
    });
    const canonicalRetry = await command({
      kind: 'update_node',
      commandId,
      nodeId,
      expectedVersion: 0,
      patch: { content: '**After.**' }
    });

    expect(legacyUpdate.status).toBe(200);
    expect(canonicalRetry.status).toBe(200);
    const retryResult = ProjectCommandResponseSchema.parse(await canonicalRetry.json());
    expect(retryResult.disposition).toBe('replayed');
    expect(retryResult.project.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      kind: 'note',
      content: '**After.**'
    });
    const legacyRetry = await command({
      kind: 'update_node',
      commandId,
      nodeId,
      expectedVersion: 0,
      patch: { description: '**After.**' }
    });
    expect(legacyRetry.status).toBe(200);
    expect(ProjectCommandResponseSchema.parse(await legacyRetry.json()).disposition).toBe(
      'replayed'
    );

    const workCommandId = nextCommandId();
    const workUpdate = await command({
      kind: 'update_node',
      commandId: workCommandId,
      nodeId: 'local',
      expectedVersion: 0,
      patch: { description: 'Still a Work Node description.' }
    });
    expect(workUpdate.status).toBe(200);
    const workResult = ProjectCommandResponseSchema.parse(await workUpdate.json());
    expect(workResult.project.nodes.find(({ id }) => id === 'local')).toMatchObject({
      description: 'Still a Work Node description.'
    });
    const invalidContentReuse = await command({
      kind: 'update_node',
      commandId: workCommandId,
      nodeId: 'local',
      expectedVersion: 0,
      patch: { content: 'Still a Work Node description.' }
    });
    expect(invalidContentReuse.status).toBe(409);
    expect(await invalidContentReuse.json()).toMatchObject({ code: 'command_conflict' });
  });

  it.each([{}, { kind: 'unknown_command' }])(
    'returns validation errors for missing and unknown command discriminators',
    async (body) => {
      const response = await command(body);
      expect(response.status).toBe(400);
      const error = ApiErrorSchema.parse(await response.json());
      expect(error.code).toBe('validation_error');
      if (error.code !== 'validation_error') throw new Error('Expected a validation error.');
      expect(error.details.issues).toContainEqual(
        expect.objectContaining({ path: ['kind'], code: 'invalid_union' })
      );
    }
  );

  it('distinguishes malformed request JSON from server-side syntax failures', async () => {
    const app = createApp(new ProjectApplication(repository), repository.readiness);
    const invalidJson = await app.request('/api/projects/default/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({
      code: 'invalid_json',
      error: 'The request body was not valid JSON.'
    });

    const syntaxFailure = new ProjectApplication(repository);
    const executeCommand = vi.spyOn(syntaxFailure, 'executeCommand').mockImplementation(() => {
      throw new SyntaxError('Corrupt stored receipt.');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const serverFailure = await createApp(syntaxFailure, repository.readiness).request(
      '/api/projects/default/commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'delete_relationship',
          commandId: nextCommandId(),
          relationshipId: 'local-before-agent'
        })
      }
    );

    expect(serverFailure.status).toBe(500);
    expect(await serverFailure.json()).toEqual({
      code: 'unexpected',
      error: 'An unexpected local error occurred.'
    });
    expect(consoleError).toHaveBeenCalledWith(expect.any(SyntaxError));
    executeCommand.mockRestore();
    consoleError.mockRestore();
  });

  it('returns not found when executing under an unknown project', async () => {
    const response = await command(
      {
        kind: 'create_node',
        nodeId: '00000000-0000-4000-8000-000000000103',
        input: { title: 'Lost node', kind: 'task', position: { x: 0, y: 0 } }
      },
      'missing'
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Project missing does not exist.' });
  });

  it('rejects relationship cycles before persistence', async () => {
    const response = await command({
      kind: 'create_relationship',
      relationshipId: '00000000-0000-4000-8000-000000000104',
      input: { dependentId: 'local', dependencyId: 'n2-group', kind: 'depends_on' }
    });

    expect(response.status).toBe(409);
  });

  it('does not persist a command receipt when its mutation rolls back', async () => {
    const create = {
      kind: 'create_relationship',
      commandId: nextCommandId(),
      relationshipId: '00000000-0000-4000-8000-000000000113',
      input: { dependentId: 'local', dependencyId: 'agent', kind: 'depends_on' }
    };
    const rejected = await command(create);
    expect(rejected.status).toBe(409);

    await command({
      kind: 'delete_relationship',
      relationshipId: 'local-before-agent'
    });
    const retried = await command(create);

    expect(retried.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await retried.json());
    expect(result.disposition).toBe('applied');
    expect(
      result.project.relationships.find(({ id }) => id === create.relationshipId)
    ).toBeDefined();
  });

  it('moves multiple nodes through one atomic command', async () => {
    const commandId = nextCommandId();
    const response = await command({
      kind: 'move_nodes',
      commandId,
      moves: {
        domain: { position: { x: 700, y: 100 }, expectedVersion: 0 },
        local: { position: { x: 700, y: 300 }, expectedVersion: 0 }
      }
    });

    expect(response.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await response.json());
    expect(result.outcome).toEqual({ kind: 'nodes_moved', nodeIds: ['domain', 'local'] });
    expect(result.project.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'domain', position: { x: 700, y: 100 }, version: 1 }),
        expect.objectContaining({ id: 'local', position: { x: 700, y: 300 }, version: 1 })
      ])
    );

    const replay = await command({
      kind: 'move_nodes',
      commandId,
      moves: {
        local: { position: { x: 700, y: 300 }, expectedVersion: 0 },
        domain: { position: { x: 700, y: 100 }, expectedVersion: 0 }
      }
    });
    expect(replay.status).toBe(200);
    const replayed = ProjectCommandResponseSchema.parse(await replay.json());
    expect(replayed.disposition).toBe('replayed');
    expect(replayed.outcome).toEqual({ kind: 'nodes_moved', nodeIds: ['domain', 'local'] });
  });

  it('returns the projected graph after an idempotent node deletion', async () => {
    const deletion = {
      kind: 'delete_node',
      commandId: nextCommandId(),
      nodeId: 'local',
      expectedVersion: 0
    };
    const response = await command(deletion);
    const retry = await command(deletion);

    expect(response.status).toBe(200);
    expect(retry.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await retry.json());
    expect(result.project.nodes.some(({ id }) => id === 'local')).toBe(false);
    expect(result.outcome).toEqual({ kind: 'node_deleted', nodeId: 'local' });
  });

  it('creates a second membership parent through the shared command surface', async () => {
    await command({
      kind: 'create_node',
      nodeId: '00000000-0000-4000-8000-000000000105',
      input: { title: 'Other group', kind: 'group', position: { x: 0, y: 0 } }
    });

    const response = await command({
      kind: 'create_relationship',
      relationshipId: '00000000-0000-4000-8000-000000000106',
      input: {
        memberId: 'local',
        groupId: '00000000-0000-4000-8000-000000000105',
        kind: 'member_of'
      }
    });

    expect(response.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await response.json());
    expect(
      result.project.relationships.filter(
        (relationship) => relationship.kind === 'member_of' && relationship.memberId === 'local'
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'member-local', groupId: 'n2-group' }),
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000106',
          groupId: '00000000-0000-4000-8000-000000000105'
        })
      ])
    );
  });

  it('deletes relationships idempotently while preserving endpoint nodes', async () => {
    const deletion = {
      kind: 'delete_relationship',
      commandId: nextCommandId(),
      relationshipId: 'local-before-agent'
    };
    const response = await command(deletion);
    const retry = await command(deletion);

    expect(response.status).toBe(200);
    expect(retry.status).toBe(200);
    const result = ProjectCommandResponseSchema.parse(await retry.json());
    expect(result.project.relationships.some(({ id }) => id === 'local-before-agent')).toBe(false);
    expect(result.project.nodes.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['local', 'agent'])
    );
  });

  it.each([
    ['POST', '/api/projects/default/nodes'],
    ['PATCH', '/api/projects/default/nodes'],
    ['PATCH', '/api/projects/default/nodes/local'],
    ['DELETE', '/api/projects/default/nodes/local'],
    ['POST', '/api/projects/default/relationships'],
    ['DELETE', '/api/projects/default/relationships/local-before-agent']
  ])('does not expose the obsolete %s %s mutation route', async (method, path) => {
    const response = await createApp(
      new ProjectApplication(repository),
      repository.readiness
    ).request(path, { method });

    expect(response.status).toBe(404);
  });
});
