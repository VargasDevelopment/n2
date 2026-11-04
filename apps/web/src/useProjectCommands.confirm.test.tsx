import type { ProjectedProject } from '@n2/contracts';
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
const project: ProjectedProject = {
  id: 'project',
  name: 'Project',
  referenceKey: 'N2',
  nodes: [
    {
      id: 'node',
      reference: 'N2-1',
      title: 'Node',
      description: '',
      kind: 'task',
      requestedStatus: 'ready',
      effectiveStatus: 'ready',
      progress: 0,
      blockedBy: [],
      position: { x: 0, y: 0 },
      version: 0,
      createdAt: now,
      updatedAt: now
    }
  ],
  relationships: [],
  warnings: [],
  latestSequence: 0
};

const renderProjectCommands = (reportError = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  queryClient.setQueryData(projectQueryKey('project'), project);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useProjectCommands('project', reportError), { wrapper }).result;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useProjectCommands confirmation', () => {
  it('treats a rejected command confirmation as a non-error cancellation', async () => {
    const reportError = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const result = renderProjectCommands(reportError);

    await expect(
      result.current.dispatch({ kind: 'delete_node', nodeId: 'node' }, { confirm })
    ).resolves.toEqual({ status: 'canceled', project });

    expect(confirm).toHaveBeenCalledWith(project);
    expect(api.executeProjectCommand).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('confirms before treating an already-absent delete target as fulfilled', async () => {
    // A multi-node delete confirms the whole set on its first command, even if that one is gone.
    const confirm = vi.fn().mockResolvedValue(true);
    const result = renderProjectCommands();

    await expect(
      result.current.dispatch({ kind: 'delete_node', nodeId: 'already-gone' }, { confirm })
    ).resolves.toEqual({ status: 'executed', project });

    expect(confirm).toHaveBeenCalledWith(project);
    expect(api.executeProjectCommand).not.toHaveBeenCalled();
  });
});
