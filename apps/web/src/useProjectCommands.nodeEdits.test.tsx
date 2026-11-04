import type { ProjectCommandInput, ProjectedProject } from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectQueryKey, useProjectCommands } from './useProjectCommands.js';

const api = vi.hoisted(() => ({ executeProjectCommand: vi.fn(), getProject: vi.fn() }));
vi.mock('./api.js', () => api);

const project = (title: string, version: number): ProjectedProject => ({
  id: 'project',
  name: 'Project',
  referenceKey: 'N2',
  nodes: [
    {
      id: 'node',
      reference: 'N2-1',
      title,
      description: '',
      kind: 'task',
      requestedStatus: 'ready',
      effectiveStatus: 'ready',
      progress: 0,
      blockedBy: [],
      position: { x: 0, y: 0 },
      version,
      createdAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-21T12:00:00.000Z'
    }
  ],
  relationships: [],
  warnings: [],
  latestSequence: 0
});

const renderCommands = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  queryClient.setQueryData(projectQueryKey('project'), project('Original', 0));
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    queryClient,
    ...renderHook(() => useProjectCommands('project', () => undefined), { wrapper })
  };
};

const rename = (title: string) =>
  ({ kind: 'update_node', nodeId: 'node', patch: { title } }) as const;

/** A server that applies every rename; with `holdFirst`, the first waits for `release`. */
const createServer = ({ holdFirst }: { holdFirst: boolean }) => {
  let version = 0;
  let release = () => undefined as void;
  const gate = new Promise<void>((open) => {
    release = open;
  });
  api.executeProjectCommand.mockImplementation(
    async (_projectId: string, command: ProjectCommandInput) => {
      if (holdFirst && version === 0) await gate;
      if (command.kind !== 'update_node' || command.patch.title === undefined) {
        throw new Error('Expected a rename.');
      }
      version += 1;
      return {
        commandId: command.commandId,
        disposition: 'applied',
        project: project(command.patch.title, version),
        outcome: { kind: 'node_updated', nodeId: 'node' },
        effects: { completedGroupIds: [] }
      };
    }
  );
  return {
    release,
    sentTitles: () =>
      api.executeProjectCommand.mock.calls.map(([, command]: unknown[]) =>
        command && typeof command === 'object' && 'patch' in command ? command.patch : null
      )
  };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Every submitted edit is sent, in order; only the server knows whether a value already holds.
describe('node edits through the project command queue', () => {
  it('sends an edit the cache says already holds, since the server may hold another value', async () => {
    const server = createServer({ holdFirst: false });
    const { result } = renderCommands();

    await expect(result.current.dispatch(rename('Original'))).resolves.toEqual({
      status: 'executed',
      project: project('Original', 1)
    });
    expect(server.sentTitles()).toEqual([{ title: 'Original' }]);
  });

  it('sends every queued edit in order, a repeat and a revert included', async () => {
    const server = createServer({ holdFirst: true });
    const { result } = renderCommands();

    void result.current.dispatch(rename('Renamed'));
    void result.current.dispatch(rename('Renamed'));
    const revert = result.current.dispatch(rename('Original'));
    await act(async () => {
      server.release();
      await revert;
    });

    expect(server.sentTitles()).toEqual([
      { title: 'Renamed' },
      { title: 'Renamed' },
      { title: 'Original' }
    ]);
  });

  it('sends a queued revert even when a delayed stale read puts the old value back', async () => {
    const server = createServer({ holdFirst: true });
    const { queryClient, result } = renderCommands();
    // The read started while Renamed was saving lands during the refresh after it applies.
    const refresh = queryClient.invalidateQueries.bind(queryClient);
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementationOnce(async (filters) => {
      queryClient.setQueryData(projectQueryKey('project'), project('Original', 0));
      await refresh(filters);
    });

    void result.current.dispatch(rename('Renamed'));
    const revert = result.current.dispatch(rename('Original'));
    await act(async () => {
      server.release();
      await revert;
    });

    expect(server.sentTitles()).toEqual([{ title: 'Renamed' }, { title: 'Original' }]);
    expect(queryClient.getQueryData(projectQueryKey('project'))).toEqual(project('Original', 2));
  });
});
