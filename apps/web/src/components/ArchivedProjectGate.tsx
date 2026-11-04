import type { ReactNode } from 'react';
import {
  usePendingLifecycleChange,
  useProjectLibraryQuery,
  useProjectLifecycle
} from '../projectLibraryQueries.js';

type ArchivedProjectGateProps = {
  projectId: string;
  inert: boolean;
  onOpenLibrary: () => void;
  children: ReactNode;
};

/**
 * Archived Projects are not opened for work. A stale link shows the archived state with Restore
 * instead of a canvas whose every change would be rejected.
 */
export function ArchivedProjectGate({
  projectId,
  inert,
  onOpenLibrary,
  children
}: ArchivedProjectGateProps) {
  const library = useProjectLibraryQuery();
  const restore = useProjectLifecycle();
  const pending = usePendingLifecycleChange(projectId);

  if (library.isPending) {
    return (
      <main className="center-state document-screen" inert={inert}>
        Opening your local project…
      </main>
    );
  }
  // An unreachable Library falls through so the workspace reports the service failure itself.
  const project = library.data?.projects.find(({ id }) => id === projectId);
  if (!project?.archivedAt) return children;

  return (
    <main className="center-state archived-project-state document-screen" inert={inert}>
      <span className="archived-project-state__eyebrow">Archived Project</span>
      <strong>{project.name} is archived.</strong>
      <span>
        Its graph, references, and history are kept unchanged. Restore it to keep working.
      </span>
      <div className="center-state__actions">
        <button
          className="center-state__action"
          type="button"
          disabled={pending !== undefined}
          onClick={() => restore.mutate({ kind: 'restore', projectId })}
        >
          {pending?.kind === 'restore' ? 'Restoring…' : 'Restore Project'}
        </button>
        <button className="center-state__action" type="button" onClick={onOpenLibrary}>
          Back to Project Library
        </button>
      </div>
      {restore.error ? (
        <span className="archived-project-state__error" role="alert">
          {restore.error.message}
        </span>
      ) : null}
    </main>
  );
}
