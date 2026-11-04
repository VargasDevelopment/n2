import { ProjectCommandSchema } from '@n2/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectApplication } from '../src/index.js';
import { MemoryProjectStore } from './memoryProjectStore.js';

describe('ProjectApplication', () => {
  let application: ProjectApplication;

  beforeEach(() => {
    application = new ProjectApplication(new MemoryProjectStore());
  });

  it('executes a canonical command and returns its outcome with the current projection', () => {
    const command = ProjectCommandSchema.parse({
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000001',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { requestedStatus: 'done' }
    });

    const result = application.executeCommand('default', command);

    expect(result.outcome).toEqual({ kind: 'node_updated', nodeId: 'local' });
    expect(result.project.nodes.find(({ id }) => id === 'local')).toMatchObject({
      requestedStatus: 'done',
      version: 1
    });
  });

  it('makes caller-identified creation safe to retry', () => {
    const command = {
      kind: 'create_node' as const,
      commandId: '00000000-0000-4000-8000-000000000002',
      nodeId: '00000000-0000-4000-8000-000000000003',
      input: { title: 'New node', kind: 'task' as const, position: { x: 12, y: 24 } }
    };

    const first = application.executeCommand('default', command);
    const retry = application.executeCommand('default', command);

    expect(first.outcome).toEqual({
      kind: 'node_created',
      nodeId: '00000000-0000-4000-8000-000000000003'
    });
    expect(first.disposition).toBe('applied');
    expect(retry.disposition).toBe('replayed');
    expect(retry.outcome).toEqual(first.outcome);
    expect(
      retry.project.nodes.filter(({ id }) => id === '00000000-0000-4000-8000-000000000003')
    ).toHaveLength(1);
  });

  it('explains derived state with named relationship roles', () => {
    application.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000004',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { requestedStatus: 'blocked' }
    });

    const explanation = application.explainNode('default', 'n2-2');

    expect(explanation.status).toMatchObject({
      effective: 'blocked',
      basis: 'blocking_relationships',
      blockers: [
        {
          kind: 'blocked_dependency',
          relationshipId: 'local-before-agent',
          node: { id: 'local', reference: 'N2-1' }
        }
      ]
    });
    expect(explanation.relationships.dependencies).toHaveLength(1);
    expect(explanation.relationships.dependencies[0]?.relationshipId).toBe('local-before-agent');
    expect(explanation.relationships.dependencies[0]?.node.id).toBe('local');
  });

  it('gives an exact canonical ID precedence over a colliding human reference', () => {
    expect(application.explainNode('default', 'N2-2').node).toMatchObject({
      id: 'N2-2',
      reference: 'N2-3'
    });
    expect(application.explainNode('default', 'n2-2').node).toMatchObject({
      id: 'agent',
      reference: 'N2-2'
    });
  });

  it('enforces relationship invariants before calling any storage adapter', () => {
    expect(() =>
      application.executeCommand('default', {
        kind: 'create_relationship',
        commandId: '00000000-0000-4000-8000-000000000005',
        relationshipId: '00000000-0000-4000-8000-000000000006',
        input: { kind: 'depends_on', dependentId: 'local', dependencyId: 'agent' }
      })
    ).toThrowError(expect.objectContaining({ violation: 'cycle' }));
  });

  it('creates and edits a note without assigning work state', () => {
    const noteId = '00000000-0000-4000-8000-000000000011';
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000010',
      nodeId: noteId,
      input: {
        kind: 'note',
        title: 'Decision context',
        content: '**Why:** local-first',
        position: { x: 40, y: 80 }
      }
    });
    const result = application.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000012',
      nodeId: noteId,
      expectedVersion: 0,
      patch: { content: '## Why\n\nLocal-first.' }
    });

    expect(result.project.nodes.find(({ id }) => id === noteId)).toEqual(
      expect.objectContaining({
        kind: 'note',
        title: 'Decision context',
        content: '## Why\n\nLocal-first.',
        version: 1
      })
    );
    expect(result.project.nodes.find(({ id }) => id === noteId)).not.toHaveProperty(
      'requestedStatus'
    );
  });

  it('creates, replaces, and clears a Work Node Planning Placement atomically', () => {
    const nodeId = '00000000-0000-4000-8000-000000000021';
    const created = application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000022',
      nodeId,
      input: {
        kind: 'task',
        title: 'Plan this work',
        planningPlacement: {
          kind: 'window',
          startDate: '2026-09-01',
          endDate: '2026-09-01'
        },
        position: { x: 0, y: 0 }
      }
    });
    expect(created.project.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      planningPlacement: {
        kind: 'window',
        startDate: '2026-09-01',
        endDate: '2026-09-01'
      }
    });

    const milestone = application.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000023',
      nodeId,
      expectedVersion: 0,
      patch: { planningPlacement: { kind: 'milestone', date: '2026-09-15' } }
    });
    expect(milestone.project.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      planningPlacement: { kind: 'milestone', date: '2026-09-15' },
      version: 1
    });

    const unscheduled = application.executeCommand('default', {
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000024',
      nodeId,
      expectedVersion: 1,
      patch: { planningPlacement: null }
    });
    expect(unscheduled.project.nodes.find(({ id }) => id === nodeId)).not.toHaveProperty(
      'planningPlacement'
    );
  });

  it('rejects work fields on notes and note content on work nodes', () => {
    const noteId = '00000000-0000-4000-8000-000000000014';
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000013',
      nodeId: noteId,
      input: { kind: 'note', title: 'Boundary', content: '', position: { x: 0, y: 0 } }
    });

    expect(() =>
      application.executeCommand('default', {
        kind: 'update_node',
        commandId: '00000000-0000-4000-8000-000000000015',
        nodeId: noteId,
        expectedVersion: 0,
        patch: {
          requestedStatus: 'done',
          description: 'Work semantics',
          planningPlacement: null
        }
      })
    ).toThrowError(
      expect.objectContaining({
        itemKind: 'note',
        fields: ['description', 'requestedStatus', 'planningPlacement']
      })
    );
    expect(() =>
      application.executeCommand('default', {
        kind: 'update_node',
        commandId: '00000000-0000-4000-8000-000000000016',
        nodeId: 'local',
        expectedVersion: 0,
        patch: { content: 'Annotation semantics' }
      })
    ).toThrowError(expect.objectContaining({ itemKind: 'task', fields: ['content'] }));
  });

  it('refuses relationships and work explanations for notes', () => {
    const noteId = '00000000-0000-4000-8000-000000000018';
    application.executeCommand('default', {
      kind: 'create_node',
      commandId: '00000000-0000-4000-8000-000000000017',
      nodeId: noteId,
      input: { kind: 'note', title: 'Context', content: '', position: { x: 0, y: 0 } }
    });

    expect(() =>
      application.executeCommand('default', {
        kind: 'create_relationship',
        commandId: '00000000-0000-4000-8000-000000000019',
        relationshipId: '00000000-0000-4000-8000-000000000020',
        input: { kind: 'depends_on', dependentId: 'local', dependencyId: noteId }
      })
    ).toThrowError(expect.objectContaining({ violation: 'work_node_required' }));
    expect(() => application.explainNode('default', noteId)).toThrowError(
      `Work node ${noteId} does not exist in this project.`
    );
  });

  it('treats the scoped writer and command receipt as one transaction', () => {
    const store = new MemoryProjectStore();
    const transactionalApplication = new ProjectApplication(store);
    const before = store.getProject();

    expect(() =>
      transactionalApplication.executeCommand('default', {
        kind: 'move_nodes',
        commandId: '00000000-0000-4000-8000-000000000007',
        moves: {
          local: { position: { x: 100, y: 100 }, expectedVersion: 0 },
          agent: { position: { x: 200, y: 200 }, expectedVersion: 99 }
        }
      })
    ).toThrowError(expect.objectContaining({ currentVersion: 0 }));

    expect(store.getProject()).toEqual(before);
  });
});
