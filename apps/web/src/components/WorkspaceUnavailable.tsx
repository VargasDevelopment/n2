import type { UseQueryResult } from '@tanstack/react-query';
import { queryView } from '../queryView.js';

type WorkspaceQuery = Pick<UseQueryResult<unknown>, 'data' | 'error' | 'isFetching' | 'refetch'>;

/** Shown only when the workspace lacks data it needs; a failed refresh keeps the canvas instead. */
export function WorkspaceUnavailable({
  inert,
  onOpenLibrary,
  queries
}: {
  inert: boolean;
  onOpenLibrary: () => void;
  queries: readonly WorkspaceQuery[];
}) {
  const unavailable = queries.flatMap((query) => {
    const view = queryView(query);
    return view.status === 'unavailable' ? [view.error] : [];
  });
  const retrying = queries.some((query) => query.isFetching);
  return (
    <main className="center-state center-state--error document-screen" inert={inert}>
      <strong>N² could not reach its local service.</strong>
      <span>{unavailable[0]?.message ?? 'Project data is unavailable.'}</span>
      <div className="center-state__actions">
        <button
          className="center-state__action"
          type="button"
          disabled={retrying}
          onClick={() => queries.forEach((query) => void query.refetch())}
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
        <button className="center-state__action" type="button" onClick={onOpenLibrary}>
          Back to Project Library
        </button>
      </div>
    </main>
  );
}
