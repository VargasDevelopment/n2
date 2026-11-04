import type { ProjectCommandResponse, ProjectedProject } from '@n2/contracts';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executionQueryKey, projectQueryKey, useProjectCommands } from './useProjectCommands.js';

const api = vi.hoisted(() => ({
  executeProjectCommand: vi.fn(),
  getProject: vi.fn()
}));
vi.mock('./api.js', () => api);

const now = '2026-10-15T12:00:00.000Z';
const project = (version: number): ProjectedProject => ({
  id: 'project',
  name: 'Project',
  referenceKey: 'N2',
  nodes: [
    {
      id: 'node',
      reference: 'N2-1',
      title: 'Task',
      description: '',
      kind: 'task',
      requestedStatus: 'ready',
      effectiveStatus: 'ready',
      progress: 0,
      blockedBy: [],
      position: { x: version, y: 0 },
      version,
      createdAt: now,
      updatedAt: now
    }
  ],
  relationships: [],
  warnings: [],
  latestSequence: 0
});
const commandResponse = (value: ProjectedProject): ProjectCommandResponse => ({
  commandId: '00000000-0000-4000-8000-000000000001',
  disposition: 'applied',
  project: value,
  outcome: { kind: 'node_updated', nodeId: 'node' },
  effects: { completedGroupIds: [] }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useProjectCommands execution refresh', () => {
  it('stays pending until fresh execution state is installed after a command', async () => {
    const after = project(1);
    api.executeProjectCommand.mockResolvedValueOnce(commandResponse(after));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    queryClient.setQueryData(projectQueryKey('project'), project(0));
    queryClient.setQueryData(executionQueryKey('project'), { refreshed: false });
    let releaseExecution: (value: { refreshed: boolean }) => void = () => undefined;
    const executionFetch = vi.fn(
      () => new Promise<{ refreshed: boolean }>((resolve) => (releaseExecution = resolve))
    );
    const observer = new QueryObserver(queryClient, {
      queryKey: executionQueryKey('project'),
      queryFn: executionFetch,
      staleTime: Infinity
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useProjectCommands('project', vi.fn()), { wrapper });

    let settled = false;
    const dispatched = result.current
      .dispatch({ kind: 'move_nodes', moves: [{ nodeId: 'node', position: { x: 1, y: 0 } }] })
      .then((outcome) => {
        settled = true;
        return outcome;
      });

    await vi.waitFor(() => expect(executionFetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseExecution({ refreshed: true });
    await expect(dispatched).resolves.toEqual({ status: 'executed', project: after });
    expect(queryClient.getQueryData(executionQueryKey('project'))).toEqual({ refreshed: true });
    unsubscribe();
  });
});
