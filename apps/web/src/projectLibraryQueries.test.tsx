import type { ProjectLibrary, ProjectSummary } from '@n2/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';
import {
  mergeProjectSummary,
  PROJECT_LIBRARY_QUERY_KEY,
  usePendingLifecycleChange,
  useProjectLibraryQuery,
  useProjectLifecycle,
  type ProjectLifecycleChange
} from './projectLibraryQueries.js';

vi.mock('./api.js', () => ({
  archiveProject: vi.fn(),
  getExecution: vi.fn(),
  listProjects: vi.fn(),
  renameProject: vi.fn(),
  restoreProject: vi.fn()
}));

const before: ProjectSummary = {
  id: 'project',
  name: 'Before',
  referenceKey: 'PRJ',
  canvasItemCount: 0,
  archivedAt: null,
  lifecycleRevision: 0
};
const archivedAt = '2026-10-18T12:00:00.000Z';
const libraryOf = (project: ProjectSummary): ProjectLibrary => ({ projects: [project] });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rename = {
  change: { kind: 'rename', projectId: before.id, name: 'After' },
  result: { ...before, name: 'After', lifecycleRevision: 1 }
} satisfies { change: ProjectLifecycleChange; result: ProjectSummary };

const cases: {
  name: string;
  cached: boolean;
  change: ProjectLifecycleChange;
  result: ProjectSummary;
}[] = [
  { name: 'a rename over a first Library fetch in flight', cached: false, ...rename },
  { name: 'a rename over a cached Library refetch in flight', cached: true, ...rename },
  {
    name: 'an archive over a cached Library refetch in flight',
    cached: true,
    change: { kind: 'archive', projectId: before.id },
    result: { ...before, archivedAt, lifecycleRevision: 1 }
  },
  {
    name: 'a restore over a cached Library refetch in flight',
    cached: true,
    change: { kind: 'restore', projectId: before.id },
    result: { ...before, lifecycleRevision: 1 }
  }
];

describe('reconciling a Project lifecycle result', () => {
  it.each(cases)('$name keeps the result', async ({ cached, change, result }) => {
    // The service's stored Project; the lifecycle change replaces it.
    let stored: ProjectSummary = change.kind === 'restore' ? { ...before, archivedAt } : before;
    const listProjects = vi.mocked(api.listProjects);
    listProjects.mockImplementation(() => Promise.resolve(libraryOf(stored)));
    const commit = () => {
      stored = result;
      return Promise.resolve({ disposition: 'updated' as const, project: result });
    };
    vi.mocked(api.renameProject).mockImplementation(commit);
    vi.mocked(api.archiveProject).mockImplementation(commit);
    vi.mocked(api.restoreProject).mockImplementation(commit);
    // Holds the next fetch, which has already read the pre-change Project, until answered.
    const holdNextFetch = () => {
      const stale = libraryOf(stored);
      let answer = (): void => undefined;
      listProjects.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = () => resolve(stale);
          })
      );
      return () => answer();
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let answerStale = cached ? () => undefined : holdNextFetch();
    const { result: hook } = renderHook(
      () => ({ library: useProjectLibraryQuery(), lifecycle: useProjectLifecycle() }),
      { wrapper }
    );
    if (cached) {
      await waitFor(() => expect(hook.current.library.data).toBeDefined());
      answerStale = holdNextFetch();
      void queryClient.refetchQueries({ queryKey: PROJECT_LIBRARY_QUERY_KEY });
    }
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(cached ? 2 : 1));

    const fetchesBeforeResult = listProjects.mock.calls.length;
    await act(() => hook.current.lifecycle.mutateAsync(change));
    act(() => answerStale());
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(queryClient.getQueryData(PROJECT_LIBRARY_QUERY_KEY)).toEqual(libraryOf(result));
    expect(listProjects.mock.calls.length).toBeGreaterThan(fetchesBeforeResult);
  });
});

/** How the service applies a change: every committed lifecycle change raises the revision. */
const applied = (project: ProjectSummary, change: ProjectLifecycleChange): ProjectSummary => {
  const next = { ...project, lifecycleRevision: project.lifecycleRevision + 1 };
  switch (change.kind) {
    case 'rename':
      return { ...next, name: change.name };
    case 'archive':
      return { ...next, archivedAt };
    case 'restore':
      return { ...next, archivedAt: null };
  }
};

const renderLibraryHooks = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const useCard = () => ({
    library: useProjectLibraryQuery(),
    lifecycle: useProjectLifecycle(),
    pending: usePendingLifecycleChange(before.id)
  });
  return { queryClient, mount: () => renderHook(useCard, { wrapper }) };
};

/** A service that commits each change on arrival but can hold back one chosen response. */
const serveLifecycle = (initial: ProjectSummary, held: ProjectLifecycleChange) => {
  const service = { stored: initial, release: (): void => undefined };
  const commit = (change: ProjectLifecycleChange) => {
    service.stored = applied(service.stored, change);
    const response = { disposition: 'updated' as const, project: service.stored };
    if (change !== held) return Promise.resolve(response);
    return new Promise<typeof response>((resolve) => {
      service.release = () => resolve(response);
    });
  };
  return { service, commit };
};

describe('ordering Project lifecycle results', () => {
  it.each<{ name: string; first: ProjectLifecycleChange; second: ProjectLifecycleChange }>([
    {
      name: 'a rename after a remount over an earlier held rename',
      first: { kind: 'rename', projectId: before.id, name: 'First' },
      second: { kind: 'rename', projectId: before.id, name: 'Second' }
    },
    {
      name: 'an archive over an earlier held rename',
      first: { kind: 'rename', projectId: before.id, name: 'First' },
      second: { kind: 'archive', projectId: before.id }
    }
  ])('keeps the last committed result for $name', async ({ first, second }) => {
    const { service, commit } = serveLifecycle(before, first);
    vi.mocked(api.renameProject).mockImplementation((_projectId, { name }) =>
      commit(first.kind === 'rename' && first.name === name ? first : second)
    );
    vi.mocked(api.archiveProject).mockImplementation(() => commit(second));
    const listProjects = vi.mocked(api.listProjects);
    listProjects.mockImplementation(() => Promise.resolve(libraryOf(service.stored)));
    const { queryClient, mount } = renderLibraryHooks();

    const firstCard = mount();
    await waitFor(() => expect(firstCard.result.current.library.data).toBeDefined());
    const firstResult = firstCard.result.current.lifecycle.mutateAsync(first);
    await waitFor(() => expect(api.renameProject).toHaveBeenCalledTimes(1));

    // The card remounts while the first change is still in flight; it must not look idle.
    firstCard.unmount();
    const card = mount();
    await waitFor(() => expect(card.result.current.pending).toEqual(first));
    await act(() => card.result.current.lifecycle.mutateAsync(second));

    // Follow-up Library fetches never answer, so only lifecycle results can change the cache.
    listProjects.mockImplementation(() => new Promise(() => undefined));
    act(() => service.release());
    await act(() => firstResult);

    expect(service.stored).toEqual(applied(applied(before, first), second));
    expect(queryClient.getQueryData(PROJECT_LIBRARY_QUERY_KEY)).toEqual(libraryOf(service.stored));
    await waitFor(() => expect(card.result.current.pending).toBeUndefined());
  });

  it.each<{
    name: string;
    initial: ProjectSummary;
    held: ProjectLifecycleChange;
    external: ProjectLifecycleChange[];
  }>([
    {
      name: 'a held rename after an external rename and archive',
      initial: before,
      held: { kind: 'rename', projectId: before.id, name: 'Mine' },
      external: [
        { kind: 'rename', projectId: before.id, name: 'Theirs' },
        { kind: 'archive', projectId: before.id }
      ]
    },
    {
      name: 'a held archive after an external restore',
      initial: before,
      held: { kind: 'archive', projectId: before.id },
      external: [{ kind: 'restore', projectId: before.id }]
    }
  ])('ignores $name', async ({ initial, held, external }) => {
    const { service, commit } = serveLifecycle(initial, held);
    vi.mocked(api.renameProject).mockImplementation(() => commit(held));
    vi.mocked(api.archiveProject).mockImplementation(() => commit(held));
    const listProjects = vi.mocked(api.listProjects);
    listProjects.mockImplementation(() => Promise.resolve(libraryOf(service.stored)));
    const { queryClient, mount } = renderLibraryHooks();
    const card = mount();
    await waitFor(() => expect(card.result.current.library.data).toBeDefined());

    const heldResult = card.result.current.lifecycle.mutateAsync(held);
    await waitFor(() => expect(card.result.current.pending).toEqual(held));
    // The CLI or another tab changes the Project, and this tab's Library fetch observes it.
    for (const change of external) service.stored = applied(service.stored, change);
    await act(() => queryClient.refetchQueries({ queryKey: PROJECT_LIBRARY_QUERY_KEY }));
    const observed = libraryOf(service.stored);
    expect(queryClient.getQueryData(PROJECT_LIBRARY_QUERY_KEY)).toEqual(observed);

    // The older response lands while later fetches are delayed.
    listProjects.mockImplementation(() => new Promise(() => undefined));
    act(() => service.release());
    await act(() => heldResult);

    expect(queryClient.getQueryData(PROJECT_LIBRARY_QUERY_KEY)).toEqual(observed);
  });
});

describe('mergeProjectSummary', () => {
  const current = { ...before, name: 'Current', canvasItemCount: 3, lifecycleRevision: 4 };

  it('takes a newer revision', () => {
    const newer = { ...current, name: 'Newer', archivedAt, lifecycleRevision: 5 };
    expect(mergeProjectSummary(current, newer)).toEqual(newer);
  });

  it('is idempotent for an equal revision', () => {
    expect(mergeProjectSummary(current, { ...current })).toEqual(current);
    expect(mergeProjectSummary(current, mergeProjectSummary(current, current))).toEqual(current);
  });

  it('ignores the lifecycle state of an older revision but keeps its other fields', () => {
    const older = { ...current, name: 'Older', canvasItemCount: 9, lifecycleRevision: 3 };
    expect(mergeProjectSummary(current, older)).toEqual({ ...current, canvasItemCount: 9 });
  });

  it('accepts the first copy it sees', () => {
    expect(mergeProjectSummary(undefined, current)).toEqual(current);
  });
});
