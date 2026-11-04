import type { ProjectLibrary, ProjectSummary } from '@n2/contracts';
import {
  replaceEqualDeep,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query';
import * as api from './api.js';
import { executionQueryKey, PROJECT_LIBRARY_QUERY_KEY } from './useProjectCommands.js';

export { PROJECT_LIBRARY_QUERY_KEY };

// The web Library always loads Archived Projects so it can offer them in their own section.
export const useProjectLibraryQuery = () =>
  useQuery({
    queryKey: PROJECT_LIBRARY_QUERY_KEY,
    queryFn: () => api.listProjects({ includeArchived: true }),
    refetchOnMount: 'always',
    // Every write to this entry, fetched or set, passes through here. Only Library snapshots are
    // stored under this key, so both sides are ProjectLibrary values.
    structuralSharing: (current, incoming) =>
      replaceEqualDeep(
        current,
        mergeProjectLibrary(current as ProjectLibrary | undefined, incoming as ProjectLibrary)
      )
  });

/**
 * The only UI source for a Project's lifecycle metadata (name, archive state). Graph caches are
 * also written by command responses, which can land after a rename and would revert the name, so
 * the workspace's graph type omits `name` and every view reads it here instead.
 */
export const useProjectSummary = (projectId: string | undefined): ProjectSummary | undefined =>
  useProjectLibraryQuery().data?.projects.find(({ id }) => id === projectId);

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

// Mirrors the service's name-then-ID ordering so a local update never reshuffles on refetch.
const compareProjects = (left: ProjectSummary, right: ProjectSummary): number =>
  compareText(left.name, right.name) || compareText(left.id, right.id);

/**
 * Keeps whichever copy of a Project's lifecycle state is newer. Responses, Library fetches, the
 * CLI, and other tabs deliver summaries in no particular order, but the service's lifecycle
 * revision rises with every committed change, so an older copy never replaces newer state.
 * Fields outside the lifecycle (such as the canvas item count) follow the incoming copy.
 */
export const mergeProjectSummary = (
  current: ProjectSummary | undefined,
  incoming: ProjectSummary
): ProjectSummary =>
  current && current.lifecycleRevision > incoming.lifecycleRevision
    ? {
        ...incoming,
        name: current.name,
        archivedAt: current.archivedAt,
        lifecycleRevision: current.lifecycleRevision
      }
    : incoming;

const mergeProjectLibrary = (
  current: ProjectLibrary | undefined,
  incoming: ProjectLibrary
): ProjectLibrary => {
  const known = new Map(current?.projects.map((project) => [project.id, project]));
  return {
    projects: incoming.projects
      .map((project) => mergeProjectSummary(known.get(project.id), project))
      .sort(compareProjects)
  };
};

// A creation result is new to the Library, so this inserts as well as replaces.
const upsertProjectSummary = (
  library: ProjectLibrary,
  project: ProjectSummary
): ProjectLibrary => ({
  projects: [...library.projects.filter(({ id }) => id !== project.id), project].sort(
    compareProjects
  )
});

/**
 * The only way a lifecycle or creation result enters the cache. The Library entry owns the
 * summary; Execution only depends on it (claim blockers follow the archive state, which only the
 * service derives). TanStack would reuse a fetch already in flight instead of refetching, so both
 * are cancelled first. The write passes through the Library's revision merge, so ordering is
 * handled there; the refetch afterwards picks up anything else the service changed.
 */
export const reconcileProjectSummary = async (
  queryClient: QueryClient,
  project: ProjectSummary
): Promise<void> => {
  const library = { queryKey: PROJECT_LIBRARY_QUERY_KEY, exact: true };
  const execution = { queryKey: executionQueryKey(project.id), exact: true };
  await Promise.all([queryClient.cancelQueries(library), queryClient.cancelQueries(execution)]);
  queryClient.setQueryData<ProjectLibrary>(
    PROJECT_LIBRARY_QUERY_KEY,
    (current) => current && upsertProjectSummary(current, project)
  );
  void Promise.all([
    queryClient.invalidateQueries(library),
    queryClient.invalidateQueries(execution)
  ]);
};

export type ProjectLifecycleChange =
  | { kind: 'rename'; projectId: string; name: string }
  | { kind: 'archive'; projectId: string }
  | { kind: 'restore'; projectId: string };

const applyChange = (change: ProjectLifecycleChange) => {
  switch (change.kind) {
    case 'rename':
      return api.renameProject(change.projectId, { name: change.name });
    case 'archive':
      return api.archiveProject(change.projectId);
    case 'restore':
      return api.restoreProject(change.projectId);
  }
};

const PROJECT_LIFECYCLE_MUTATION_KEY = ['project-lifecycle'] as const;

/** Each caller owns its error state, so one card's failure stays on that card. */
export const useProjectLifecycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: PROJECT_LIFECYCLE_MUTATION_KEY,
    mutationFn: applyChange,
    onSuccess: ({ project }) => reconcileProjectSummary(queryClient, project),
    onError: () => void queryClient.invalidateQueries({ queryKey: PROJECT_LIBRARY_QUERY_KEY })
  });
};

/**
 * The newest running or queued lifecycle change for a Project, from any component. Reading the
 * shared MutationCache rather than one hook's state keeps a remounted card from looking idle.
 */
export const usePendingLifecycleChange = (
  projectId: string | undefined
): ProjectLifecycleChange | undefined =>
  useMutationState({
    filters: { mutationKey: PROJECT_LIFECYCLE_MUTATION_KEY, status: 'pending' },
    // Only useProjectLifecycle builds mutations under this key, so these are its variables.
    select: (mutation) => mutation.state.variables as ProjectLifecycleChange
  })
    .filter((change) => change.projectId === projectId)
    .at(-1);
