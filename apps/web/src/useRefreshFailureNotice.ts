import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSessionNotify } from './notificationContext.js';
import { queryView } from './queryView.js';

/**
 * A full-page view keeps showing the data it has when a refresh fails (see queryView), and says so
 * in one quiet toast: replaced on each failure, and kept, never timed out, until a refresh succeeds
 * or the view goes.
 */
export function useRefreshFailureNotice(
  queries: readonly Pick<UseQueryResult<unknown>, 'data' | 'error'>[],
  message: string
): void {
  const { notify, dismiss } = useSessionNotify();
  const queryClient = useQueryClient();
  const failure =
    queries.flatMap((query) => {
      const view = queryView(query);
      return view.status === 'ready' && view.refreshError ? [view.refreshError] : [];
    })[0] ?? null;

  useEffect(() => {
    if (!failure) return;
    const key = notify({
      key: 'refresh-failure',
      tone: 'info',
      persistent: true,
      message,
      detail: failure.message,
      action: {
        label: 'Try again',
        pendingLabel: 'Retrying…',
        run: () =>
          queryClient.refetchQueries(
            { type: 'active', predicate: (query) => query.state.status === 'error' },
            { throwOnError: true }
          )
      }
    });
    return () => dismiss(key);
  }, [dismiss, failure, message, notify, queryClient]);
}
