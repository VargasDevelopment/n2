import type {
  NodeStatus,
  ProjectCommandResponse,
  ProjectedNode,
  ProjectedProject,
  WorkNodeKind
} from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectQueryKey, useProjectCommands } from './useProjectCommands.js';

const api = vi.hoisted(() => ({
  executeProjectCommand: vi.fn(),
  getProject: vi.fn()
}));
vi.mock('./api.js', () => api);

const now = '2026-10-18T09:00:00.000Z';

const workNode = (
  id: string,
  kind: WorkNodeKind,
  title: string,
  requestedStatus: NodeStatus,
  effectiveStatus: NodeStatus
): ProjectedNode => ({
  id,
  reference: `N2-${id}`,
  title,
  description: '',
  kind,
  requestedStatus,
  effectiveStatus,
  progress: effectiveStatus === 'done' ? 1 : 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

// One Group with one member Task; the Group is done exactly when its Task is.
const projection = (taskStatus: NodeStatus, groupTitle = 'Launch'): ProjectedProject => ({
  id: 'project',
  name: 'Project',
  referenceKey: 'N2',
  nodes: [
    workNode('group', 'group', groupTitle, 'ready', taskStatus),
    workNode('task', 'task', 'Ship', taskStatus, taskStatus)
  ],
  relationships: [
    {
      id: 'task-in-group',
      kind: 'member_of',
      memberId: 'task',
      groupId: 'group',
      createdAt: now,
      isBlocking: false
    }
  ],
  warnings: [],
  latestSequence: 0
});

const respondWith = (project: ProjectedProject, completedGroupIds: string[]): void => {
  const response: ProjectCommandResponse = {
    commandId: '00000000-0000-4000-8000-000000000001',
    disposition: 'applied',
    project,
    outcome: { kind: 'node_updated', nodeId: 'group' },
    effects: { completedGroupIds }
  };
  api.executeProjectCommand.mockResolvedValueOnce(response);
};

const renderProjectCommands = (onGroupsCompleted: () => void) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  queryClient.setQueryData(projectQueryKey('project'), projection('ready'));
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useProjectCommands('project', vi.fn(), onGroupsCompleted), { wrapper })
    .result;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useProjectCommands Group completion', () => {
  // The cache says the Group is ready; the response shows it done because another client finished
  // its Task. Only the receipt knows which completions this command caused.
  it('does not celebrate a completion the receipt does not report', async () => {
    const onGroupsCompleted = vi.fn();
    const result = renderProjectCommands(onGroupsCompleted);
    respondWith(projection('done'), []);

    await result.current.dispatch({
      kind: 'update_node',
      nodeId: 'group',
      patch: { requestedStatus: 'in_progress' }
    });

    expect(onGroupsCompleted).not.toHaveBeenCalled();
  });

  it('celebrates exactly the Groups the receipt reports', async () => {
    const onGroupsCompleted = vi.fn();
    const result = renderProjectCommands(onGroupsCompleted);
    respondWith(projection('done'), ['group']);

    await result.current.dispatch({
      kind: 'update_node',
      nodeId: 'task',
      patch: { requestedStatus: 'done' }
    });

    expect(onGroupsCompleted).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ id: 'group' })
    ]);
  });
});
