import { N2ApiError } from '@n2/client';
import { MutationCache, QueryClient, type QueryClientConfig } from '@tanstack/react-query';
import { PROJECT_LIBRARY_QUERY_KEY } from './useProjectCommands.js';

/**
 * Builds the application's QueryClient. Any write can find its Project archived by another
 * client, and the Library is the only UI source of archive state, so every mutation's
 * `project_archived` rejection refreshes it here. That lets the workspace show the archived state.
 * Project-scoped writes must therefore run as mutations.
 */
export const createQueryClient = (config: Omit<QueryClientConfig, 'mutationCache'> = {}) => {
  const queryClient = new QueryClient({
    ...config,
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof N2ApiError && error.body.code === 'project_archived') {
          void queryClient.invalidateQueries({ queryKey: PROJECT_LIBRARY_QUERY_KEY });
        }
      }
    })
  });
  return queryClient;
};
