import { N2ApiError, N2TransportError } from '@n2/client';
import type { ProjectCommandResponse, ProjectedProject } from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectCommands, projectQueryKey } from './useProjectCommands.js';

const api = vi.hoisted(() => ({ executeProjectCommand: vi.fn(), getProject: vi.fn() }));
vi.mock('./api.js', () => api);
const now = '2026-08-21T12:00:00.000Z';
const generatedId = '00000000-0000-4000-8000-000000000001';
const project = (version: number, requestedStatus: 'ready' | 'in_progress' | 'done') =>
  ({
    id: 'project',
    name: 'Project',
    referenceKey: 'N2',
    nodes: [
      {
        id: 'node',
        reference: 'N2-1',
        title: version === 0 ? 'Original' : 'Renamed',
        description: '',
        kind: 'task',
        requestedStatus,
        effectiveStatus: requestedStatus,
        progress: requestedStatus === 'done' ? 1 : 0,
        blockedBy: [],
        position: { x: 0, y: 0 },
        version,
        createdAt: now,
        updatedAt: now
      }
    ],
    relationships: [],
    warnings: [],
    latestSequence: 0
  }) satisfies ProjectedProject;
const commandResponse = (value: ProjectedProject): ProjectCommandResponse => ({
  commandId: '00000000-0000-4000-8000-000000000001',
  disposition: 'applied',
  project: value,
  outcome: { kind: 'node_updated', nodeId: 'node' },
  effects: { completedGroupIds: [] }
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const renderProjectCommands = ({
  projectId = 'project',
  initialProject = project(0, 'ready'),
  reportError = vi.fn()
}: {
  projectId?: string;
  initialProject?: ProjectedProject;
  reportError?: (message: string) => void;
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  queryClient.setQueryData(projectQueryKey(projectId), initialProject);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(
      ({ activeProjectId }: { activeProjectId: string }) =>
        useProjectCommands(activeProjectId, reportError),
      { initialProps: { activeProjectId: projectId }, wrapper }
    ),
    queryClient
  };
};

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(generatedId);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useProjectCommands', () => {
  it('resolves every expected version for an atomic multi-node move', async () => {
    const secondNode = {
      ...project(0, 'ready').nodes[0]!,
      id: 'second',
      title: 'Second',
      version: 3
    };
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [...project(0, 'ready').nodes, secondNode]
    };
    const after: ProjectedProject = {
      ...before,
      nodes: before.nodes.map((node) => ({
        ...node,
        position: node.id === 'node' ? { x: 100, y: 80 } : { x: 400, y: 280 },
        version: node.version + 1
      }))
    };
    api.executeProjectCommand.mockResolvedValueOnce(commandResponse(after));
    const { result } = renderProjectCommands({ initialProject: before });

    await expect(
      result.current.dispatch({
        kind: 'move_nodes',
        moves: [
          { nodeId: 'node', position: { x: 100, y: 80 } },
          { nodeId: 'second', position: { x: 400, y: 280 } }
        ]
      })
    ).resolves.toEqual({ status: 'executed', project: after });

    expect(api.executeProjectCommand).toHaveBeenCalledWith('project', {
      kind: 'move_nodes',
      commandId: generatedId,
      moves: {
        node: { position: { x: 100, y: 80 }, expectedVersion: 0 },
        second: { position: { x: 400, y: 280 }, expectedVersion: 3 }
      }
    });
  });

  it('rejects duplicate node moves before translating or writing them', async () => {
    const reportError = vi.fn();
    const { result } = renderProjectCommands({ reportError });

    await expect(
      result.current.dispatch({
        kind: 'move_nodes',
        moves: [
          { nodeId: 'node', position: { x: 100, y: 80 } },
          { nodeId: 'node', position: { x: 400, y: 280 } }
        ]
      })
    ).resolves.toEqual({ status: 'failed', project: project(0, 'ready') });

    expect(api.executeProjectCommand).not.toHaveBeenCalled();
    expect(api.getProject).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith('Each node can appear only once in a move command.');
  });

  it('rejects status cycling for notes before issuing a command', async () => {
    const reportError = vi.fn();
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [
        {
          id: 'note',
          reference: 'N2-2',
          title: 'Context',
          content: '',
          kind: 'note',
          position: { x: 0, y: 0 },
          version: 0,
          createdAt: now,
          updatedAt: now
        }
      ]
    };
    const { result } = renderProjectCommands({ initialProject: before, reportError });

    await expect(
      result.current.dispatch({ kind: 'cycle_status', nodeId: 'note' })
    ).resolves.toEqual({ status: 'failed', project: before });

    expect(api.executeProjectCommand).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith('Notes do not have a work status to cycle.');
  });

  it('serializes commands and resolves each expected version when it executes', async () => {
    const first = deferred<ProjectCommandResponse>();
    const second = deferred<ProjectCommandResponse>();
    api.executeProjectCommand
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { queryClient, result } = renderProjectCommands();

    let rename!: ReturnType<typeof result.current.dispatch>;
    let cycle!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      rename = result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      });
      cycle = result.current.dispatch({ kind: 'cycle_status', nodeId: 'node' });
    });

    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledOnce());
    expect(api.executeProjectCommand).toHaveBeenNthCalledWith(1, 'project', {
      kind: 'update_node',
      commandId: generatedId,
      nodeId: 'node',
      expectedVersion: 0,
      patch: { title: 'Renamed' }
    });

    first.resolve(commandResponse(project(1, 'ready')));
    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledTimes(2));
    expect(api.executeProjectCommand).toHaveBeenNthCalledWith(2, 'project', {
      kind: 'update_node',
      commandId: generatedId,
      nodeId: 'node',
      expectedVersion: 1,
      patch: { requestedStatus: 'in_progress' }
    });

    second.resolve(commandResponse(project(2, 'in_progress')));
    await expect(rename).resolves.toEqual({ status: 'executed', project: project(1, 'ready') });
    await expect(cycle).resolves.toEqual({
      status: 'executed',
      project: project(2, 'in_progress')
    });
    expect(queryClient.getQueryData(projectQueryKey('project'))).toEqual(project(2, 'in_progress'));
  });

  it('keeps a pending command bound to the project that dispatched it across a switch', async () => {
    const pending = deferred<ProjectCommandResponse>();
    api.executeProjectCommand.mockReturnValueOnce(pending.promise);
    const projectA = { ...project(0, 'ready'), id: 'A', name: 'Project A' };
    const { queryClient, rerender, result } = renderProjectCommands({
      projectId: 'A',
      initialProject: projectA
    });
    queryClient.setQueryData(projectQueryKey('B'), {
      ...project(0, 'ready'),
      id: 'B',
      name: 'Project B'
    });

    let update!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      update = result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { position: { x: 100, y: 0 } }
      });
    });
    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledOnce());
    rerender({ activeProjectId: 'B' });

    const updatedA = { ...project(1, 'ready'), id: 'A' };
    pending.resolve(commandResponse(updatedA));
    await expect(update).resolves.toEqual({ status: 'executed', project: updatedA });

    expect(queryClient.getQueryData(projectQueryKey('A'))).toEqual(updatedA);
    expect(queryClient.getQueryData(projectQueryKey('B'))).toMatchObject({
      id: 'B',
      name: 'Project B'
    });
  });

  it('builds a guarded delete from state produced by preceding queued writes', async () => {
    const relationshipCreated = deferred<ProjectCommandResponse>();
    const dependency = {
      ...project(0, 'ready').nodes[0]!,
      id: 'dependency',
      title: 'Dependency'
    };
    const initialProject: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [...project(0, 'ready').nodes, dependency]
    };
    const afterRelationship: ProjectedProject = {
      ...initialProject,
      relationships: [
        {
          id: 'relationship',
          kind: 'depends_on',
          dependentId: 'node',
          dependencyId: 'dependency',
          createdAt: now,
          isBlocking: false
        }
      ]
    };
    const afterDelete = { ...afterRelationship, nodes: [dependency], relationships: [] };
    api.executeProjectCommand
      .mockReturnValueOnce(relationshipCreated.promise)
      .mockResolvedValueOnce(commandResponse(afterDelete));
    const confirm = vi.fn().mockResolvedValue(true);
    const { result } = renderProjectCommands({ initialProject });

    let create!: ReturnType<typeof result.current.dispatch>;
    let remove!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      create = result.current.dispatch({
        kind: 'create_relationship',
        input: {
          kind: 'depends_on',
          dependentId: 'node',
          dependencyId: 'dependency'
        }
      });
      remove = result.current.dispatch({ kind: 'delete_node', nodeId: 'node' }, { confirm });
    });

    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();

    relationshipCreated.resolve(commandResponse(afterRelationship));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(afterRelationship));
    expect(api.executeProjectCommand).toHaveBeenNthCalledWith(2, 'project', {
      kind: 'delete_node',
      commandId: generatedId,
      nodeId: 'node',
      expectedVersion: 0
    });

    await expect(create).resolves.toEqual({ status: 'executed', project: afterRelationship });
    await expect(remove).resolves.toEqual({ status: 'executed', project: afterDelete });
  });

  it('deletes a relationship from the authoritative project command state', async () => {
    const dependency = {
      ...project(0, 'ready').nodes[0]!,
      id: 'dependency',
      title: 'Dependency'
    };
    const relationship = {
      id: 'relationship',
      kind: 'depends_on' as const,
      dependentId: 'node',
      dependencyId: dependency.id,
      createdAt: now,
      isBlocking: false
    };
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [...project(0, 'ready').nodes, dependency],
      relationships: [relationship]
    };
    const after: ProjectedProject = { ...before, relationships: [] };
    api.executeProjectCommand.mockResolvedValueOnce(commandResponse(after));
    const { result } = renderProjectCommands({ initialProject: before });

    await expect(
      result.current.dispatch({
        kind: 'delete_relationship',
        relationshipId: relationship.id
      })
    ).resolves.toEqual({ status: 'executed', project: after });

    expect(api.executeProjectCommand).toHaveBeenCalledWith('project', {
      kind: 'delete_relationship',
      commandId: generatedId,
      relationshipId: relationship.id
    });
  });

  it('deletes a quarantined relationship by the stable ID exposed in project warnings', async () => {
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      warnings: [
        {
          kind: 'invalid_relationship',
          relationshipId: 'quarantined-relationship',
          violation: 'group_required',
          message: 'The relationship object must be a group.'
        }
      ]
    };
    const after: ProjectedProject = { ...before, warnings: [] };
    api.executeProjectCommand.mockResolvedValueOnce(commandResponse(after));
    const { result } = renderProjectCommands({ initialProject: before });

    await expect(
      result.current.dispatch({
        kind: 'delete_relationship',
        relationshipId: 'quarantined-relationship'
      })
    ).resolves.toEqual({ status: 'executed', project: after });

    expect(api.executeProjectCommand).toHaveBeenCalledWith('project', {
      kind: 'delete_relationship',
      commandId: generatedId,
      relationshipId: 'quarantined-relationship'
    });
  });

  it('fulfills a queued relationship delete when an earlier node delete already cascaded it', async () => {
    const nodeDeleted = deferred<ProjectCommandResponse>();
    const dependency = {
      ...project(0, 'ready').nodes[0]!,
      id: 'dependency',
      title: 'Dependency'
    };
    const relationship = {
      id: 'relationship',
      kind: 'depends_on' as const,
      dependentId: 'node',
      dependencyId: dependency.id,
      createdAt: now,
      isBlocking: false
    };
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [...project(0, 'ready').nodes, dependency],
      relationships: [relationship]
    };
    const after: ProjectedProject = { ...before, nodes: [dependency], relationships: [] };
    api.executeProjectCommand.mockReturnValueOnce(nodeDeleted.promise);
    const confirm = vi.fn().mockResolvedValue(true);
    const reportError = vi.fn();
    const { result } = renderProjectCommands({ initialProject: before, reportError });

    let removeNode!: ReturnType<typeof result.current.dispatch>;
    let removeRelationship!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      removeNode = result.current.dispatch({ kind: 'delete_node', nodeId: 'node' }, { confirm });
      removeRelationship = result.current.dispatch({
        kind: 'delete_relationship',
        relationshipId: relationship.id
      });
    });

    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledOnce());
    nodeDeleted.resolve(commandResponse(after));

    await expect(removeNode).resolves.toEqual({ status: 'executed', project: after });
    await expect(removeRelationship).resolves.toEqual({ status: 'executed', project: after });
    expect(api.executeProjectCommand).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenNthCalledWith(1, '');
    expect(reportError).toHaveBeenNthCalledWith(2, '');
  });

  it('fulfills a delete when reconciliation proves the target is already absent', async () => {
    const dependency = {
      ...project(0, 'ready').nodes[0]!,
      id: 'dependency',
      title: 'Dependency'
    };
    const relationship = {
      id: 'relationship',
      kind: 'depends_on' as const,
      dependentId: 'node',
      dependencyId: dependency.id,
      createdAt: now,
      isBlocking: false
    };
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [...project(0, 'ready').nodes, dependency],
      relationships: [relationship]
    };
    const reconciled: ProjectedProject = { ...before, relationships: [] };
    api.executeProjectCommand.mockRejectedValueOnce(new Error('Response lost'));
    api.getProject.mockResolvedValueOnce(reconciled);
    const reportError = vi.fn();
    const { queryClient, result } = renderProjectCommands({ initialProject: before, reportError });

    await expect(
      result.current.dispatch({
        kind: 'delete_relationship',
        relationshipId: relationship.id
      })
    ).resolves.toEqual({ status: 'executed', project: reconciled });

    expect(api.getProject).toHaveBeenCalledWith('project');
    expect(queryClient.getQueryData(projectQueryKey('project'))).toEqual(reconciled);
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith('');
  });

  it('recognizes a committed node creation when its response is lost', async () => {
    const before = project(0, 'ready');
    const after: ProjectedProject = {
      ...before,
      nodes: [
        ...before.nodes,
        {
          ...before.nodes[0]!,
          id: generatedId,
          title: 'Recovered create',
          position: { x: 20, y: 30 }
        }
      ]
    };
    api.executeProjectCommand
      .mockRejectedValueOnce(new N2TransportError('service_unavailable', 'Response lost'))
      .mockResolvedValueOnce(commandResponse(after));
    const { result } = renderProjectCommands({ initialProject: before });

    const outcome = await result.current.dispatch({
      kind: 'create_node',
      input: {
        title: 'Recovered create',
        description: '',
        kind: 'task',
        position: { x: 20, y: 30 }
      }
    });

    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') throw new Error('Expected recovered node creation.');
    expect(outcome.project.nodes.filter(({ title }) => title === 'Recovered create')).toHaveLength(
      1
    );
    expect(api.executeProjectCommand).toHaveBeenCalledTimes(2);
    expect(api.executeProjectCommand.mock.calls[1]).toEqual(
      api.executeProjectCommand.mock.calls[0]
    );
    expect(api.getProject).not.toHaveBeenCalled();
  });

  it('recognizes a committed relationship creation when its response is lost', async () => {
    const dependency = {
      ...project(0, 'ready').nodes[0]!,
      id: 'dependency',
      title: 'Dependency'
    };
    const before: ProjectedProject = {
      ...project(0, 'ready'),
      nodes: [...project(0, 'ready').nodes, dependency]
    };
    const after: ProjectedProject = {
      ...before,
      relationships: [
        {
          id: generatedId,
          kind: 'depends_on',
          dependentId: 'node',
          dependencyId: 'dependency',
          createdAt: now,
          isBlocking: false
        }
      ]
    };
    api.executeProjectCommand
      .mockRejectedValueOnce(new N2TransportError('service_unavailable', 'Response lost'))
      .mockResolvedValueOnce(commandResponse(after));
    const { result } = renderProjectCommands({ initialProject: before });

    const outcome = await result.current.dispatch({
      kind: 'create_relationship',
      input: { kind: 'depends_on', dependentId: 'node', dependencyId: 'dependency' }
    });

    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') {
      throw new Error('Expected recovered relationship creation.');
    }
    expect(outcome.project.relationships).toHaveLength(1);
    expect(api.executeProjectCommand).toHaveBeenCalledTimes(2);
    expect(api.executeProjectCommand.mock.calls[1]).toEqual(
      api.executeProjectCommand.mock.calls[0]
    );
    expect(api.getProject).not.toHaveBeenCalled();
  });

  it('refreshes authoritative cache before advancing a queued command after failure', async () => {
    const refresh = deferred<ProjectedProject>();
    const second = deferred<ProjectCommandResponse>();
    api.executeProjectCommand
      .mockRejectedValueOnce(new Error('Version conflict'))
      .mockReturnValueOnce(second.promise);
    api.getProject.mockReturnValueOnce(refresh.promise);
    const { queryClient, result } = renderProjectCommands();

    let rename!: ReturnType<typeof result.current.dispatch>;
    let cycle!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      rename = result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      });
      cycle = result.current.dispatch({ kind: 'cycle_status', nodeId: 'node' });
    });

    await waitFor(() => expect(api.getProject).toHaveBeenCalledWith('project'));
    expect(api.executeProjectCommand).toHaveBeenCalledOnce();

    refresh.resolve(project(1, 'ready'));
    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledTimes(2));
    expect(api.executeProjectCommand).toHaveBeenNthCalledWith(2, 'project', {
      kind: 'update_node',
      commandId: generatedId,
      nodeId: 'node',
      expectedVersion: 1,
      patch: { requestedStatus: 'in_progress' }
    });

    second.resolve(commandResponse(project(2, 'in_progress')));
    await expect(rename).resolves.toEqual({ status: 'failed', project: project(1, 'ready') });
    await expect(cycle).resolves.toEqual({
      status: 'executed',
      project: project(2, 'in_progress')
    });
    expect(queryClient.getQueryData(projectQueryKey('project'))).toEqual(project(2, 'in_progress'));
  });

  it('reports an authoritative retry conflict after an ambiguous transport failure', async () => {
    api.executeProjectCommand
      .mockRejectedValueOnce(new N2TransportError('service_timeout', 'Response lost'))
      .mockRejectedValueOnce(
        new N2ApiError(409, {
          code: 'version_conflict',
          error: 'The node changed since version 1.',
          details: { currentVersion: 1 }
        })
      );
    api.getProject.mockResolvedValueOnce(project(1, 'ready'));
    const reportError = vi.fn();
    const { result } = renderProjectCommands({ reportError });

    await expect(
      result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      })
    ).resolves.toEqual({ status: 'failed', project: project(1, 'ready') });

    expect(api.executeProjectCommand).toHaveBeenCalledTimes(2);
    expect(api.executeProjectCommand.mock.calls[1]).toEqual(
      api.executeProjectCommand.mock.calls[0]
    );
    expect(reportError).toHaveBeenLastCalledWith('The node changed since version 1.');
  });

  it('recovers a queued command after both a write and its reconciliation request fail', async () => {
    const second = deferred<ProjectCommandResponse>();
    api.executeProjectCommand
      .mockRejectedValueOnce(new Error('Version conflict'))
      .mockReturnValueOnce(second.promise);
    api.getProject
      .mockRejectedValueOnce(new Error('Local service unavailable'))
      .mockResolvedValueOnce(project(1, 'ready'));
    const reportError = vi.fn();
    const { queryClient, result } = renderProjectCommands({ reportError });

    let rename!: ReturnType<typeof result.current.dispatch>;
    let cycle!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      rename = result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      });
      cycle = result.current.dispatch({ kind: 'cycle_status', nodeId: 'node' });
    });

    await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.executeProjectCommand).toHaveBeenCalledTimes(2));
    expect(api.executeProjectCommand).toHaveBeenNthCalledWith(2, 'project', {
      kind: 'update_node',
      commandId: generatedId,
      nodeId: 'node',
      expectedVersion: 1,
      patch: { requestedStatus: 'in_progress' }
    });
    await expect(rename).resolves.toEqual({ status: 'failed', project: null });
    expect(reportError).toHaveBeenCalledWith(
      'Command failed (Version conflict). N2 could not verify the latest project state (Local service unavailable).'
    );

    second.resolve(commandResponse(project(2, 'in_progress')));
    await expect(cycle).resolves.toEqual({
      status: 'executed',
      project: project(2, 'in_progress')
    });
    expect(reportError).toHaveBeenLastCalledWith(
      'Command failed (Version conflict). N2 could not verify the latest project state (Local service unavailable).'
    );
    expect(queryClient.getQueryData(projectQueryKey('project'))).toEqual(project(2, 'in_progress'));
  });

  it('lets a command dispatched after a reported failure clear that error on success', async () => {
    api.executeProjectCommand
      .mockRejectedValueOnce(new Error('Version conflict'))
      .mockResolvedValueOnce(commandResponse(project(2, 'in_progress')));
    api.getProject.mockResolvedValueOnce(project(1, 'ready'));
    const reportError = vi.fn();
    const { result } = renderProjectCommands({ reportError });

    await act(async () => {
      await result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      });
    });
    expect(reportError).toHaveBeenLastCalledWith('Version conflict');

    await act(async () => {
      await result.current.dispatch({ kind: 'cycle_status', nodeId: 'node' });
    });
    expect(reportError).toHaveBeenLastCalledWith('');
    expect(api.executeProjectCommand).toHaveBeenNthCalledWith(2, 'project', {
      kind: 'update_node',
      commandId: generatedId,
      nodeId: 'node',
      expectedVersion: 1,
      patch: { requestedStatus: 'in_progress' }
    });
  });

  it('does not issue a queued write when authoritative state remains unavailable', async () => {
    api.executeProjectCommand.mockRejectedValueOnce(new Error('Version conflict'));
    api.getProject
      .mockRejectedValueOnce(new Error('Local service unavailable'))
      .mockRejectedValueOnce(new Error('Local service still unavailable'));
    const { queryClient, result } = renderProjectCommands();

    let rename!: ReturnType<typeof result.current.dispatch>;
    let cycle!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      rename = result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      });
      cycle = result.current.dispatch({ kind: 'cycle_status', nodeId: 'node' });
    });

    await expect(rename).resolves.toMatchObject({ status: 'failed' });
    await expect(cycle).resolves.toEqual({ status: 'failed', project: null });
    expect(api.getProject).toHaveBeenCalledTimes(2);
    expect(api.executeProjectCommand).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(projectQueryKey('project'))).toBeUndefined();
  });

  it('reports uncertain project state when a failed write cannot be reconciled', async () => {
    api.executeProjectCommand.mockRejectedValueOnce(new Error('Version conflict'));
    api.getProject.mockRejectedValueOnce(new Error('Local service unavailable'));
    const reportError = vi.fn();
    const { queryClient, result } = renderProjectCommands({ reportError });

    let rename!: ReturnType<typeof result.current.dispatch>;
    act(() => {
      rename = result.current.dispatch({
        kind: 'update_node',
        nodeId: 'node',
        patch: { title: 'Renamed' }
      });
    });

    await expect(rename).resolves.toEqual({ status: 'failed', project: null });
    expect(reportError).toHaveBeenLastCalledWith(
      'Command failed (Version conflict). N2 could not verify the latest project state (Local service unavailable).'
    );
    expect(queryClient.getQueryData(projectQueryKey('project'))).toBeUndefined();
  });
});
