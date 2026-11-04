import type { ProjectedProject } from '@n2/contracts';
import { N2ApiError } from '@n2/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './queryClient.js';
import {
  PROJECT_LIBRARY_QUERY_KEY,
  projectQueryKey,
  useProjectCommands
} from './useProjectCommands.js';

const api = vi.hoisted(() => ({
  executeProjectCommand: vi.fn(),
  getProject: vi.fn()
}));
vi.mock('./api.js', () => api);

const project: ProjectedProject = {
  id: 'project',
  name: 'Project',
  referenceKey: 'N2',
  nodes: [],
  relationships: [],
  warnings: [],
  latestSequence: 0
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useProjectCommands on an Archived Project', () => {
  it('reports the rejection and refreshes the Project Library so the workspace can react', async () => {
    const message = 'Project project is archived. Restore it before making changes.';
    api.executeProjectCommand.mockRejectedValueOnce(
      new N2ApiError(409, {
        code: 'project_archived',
        error: message,
        details: { projectId: 'project', archivedAt: '2026-10-18T12:00:00.000Z' }
      })
    );
    api.getProject.mockResolvedValue(project);
    const queryClient = createQueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    queryClient.setQueryData(projectQueryKey('project'), project);
    queryClient.setQueryData(PROJECT_LIBRARY_QUERY_KEY, { projects: [] });
    const reportError = vi.fn();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useProjectCommands('project', reportError), { wrapper });

    await expect(
      result.current.dispatch({
        kind: 'create_node',
        input: { kind: 'task', title: 'Late', description: '', position: { x: 0, y: 0 } }
      })
    ).resolves.toMatchObject({ status: 'failed' });
    expect(reportError).toHaveBeenCalledWith(message);
    expect(queryClient.getQueryState(PROJECT_LIBRARY_QUERY_KEY)?.isInvalidated).toBe(true);
  });
});
