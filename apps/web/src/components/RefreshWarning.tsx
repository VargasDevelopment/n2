import type { UseQueryResult } from '@tanstack/react-query';
import './RefreshWarning.css';

/**
 * A quiet note beside data whose refresh failed: the view keeps showing the last confirmed data
 * (see queryView) and offers a retry. For views inside overlays, where a toast could be covered.
 */
export function RefreshWarning({
  message,
  query
}: {
  message: string;
  query: Pick<UseQueryResult, 'isFetching' | 'refetch'>;
}) {
  return (
    <div className="refresh-warning" role="status">
      <span>{message}</span>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
        {query.isFetching ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}
