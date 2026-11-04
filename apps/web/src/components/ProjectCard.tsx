import { ProjectNameSchema, type ProjectSummary } from '@n2/contracts';
import { actorLabel, type DigestRow } from '../activityPresentation.js';
import { useRef, useState } from 'react';
import { usePendingLifecycleChange, useProjectLifecycle } from '../projectLibraryQueries.js';
import './ProjectCard.css';

type ProjectCardProps = {
  project: ProjectSummary;
  /** This Project's line in the Library digest, when something in it is new. */
  digest?: DigestRow | undefined;
  disabled: boolean;
  onOpen: (projectId: string) => void;
  onArchived: (project: ProjectSummary) => void;
};

const canvasItemLabel = (count: number): string =>
  `${count} canvas ${count === 1 ? 'item' : 'items'}`;

export function ProjectCard({ project, digest, disabled, onOpen, onArchived }: ProjectCardProps) {
  const lifecycle = useProjectLifecycle();
  // `null` while the card is not being renamed.
  const [draftName, setDraftName] = useState<string | null>(null);
  const cancelRename = useRef(false);
  const pending = usePendingLifecycleChange(project.id);
  const displayedName = pending?.kind === 'rename' ? pending.name : project.name;

  const startRename = (): void => {
    lifecycle.reset();
    cancelRename.current = false;
    setDraftName(project.name);
  };

  const finishRename = (): void => {
    const name = ProjectNameSchema.safeParse(draftName);
    setDraftName(null);
    if (cancelRename.current || !name.success || name.data === project.name) return;
    lifecycle.mutate({ kind: 'rename', projectId: project.id, name: name.data });
  };

  const archive = (): void => {
    // The archived card leaves the list on success, so report through the promise, not callbacks.
    lifecycle
      .mutateAsync({ kind: 'archive', projectId: project.id })
      .then(({ project: archived }) => onArchived(archived))
      .catch(() => undefined);
  };

  const glyph = (
    <span className="project-card__glyph" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );

  return (
    <article className="project-card" aria-busy={pending !== undefined}>
      {draftName === null ? (
        <button
          className="project-card__open"
          disabled={disabled}
          type="button"
          onClick={() => onOpen(project.id)}
        >
          {glyph}
          <span className="project-card__body">
            <span className="project-card__key">{project.referenceKey}</span>
            <strong>{displayedName}</strong>
            <small>{canvasItemLabel(project.canvasItemCount)}</small>
            {digest ? (
              <span className="project-card__activity">
                <span className="activity-count">{digest.unseenItemCount}</span>
                new since you looked · latest by {actorLabel(digest.actors[0] ?? null)}
              </span>
            ) : null}
          </span>
          <span className="project-card__arrow" aria-hidden="true">
            →
          </span>
        </button>
      ) : (
        <div className="project-card__open project-card__open--renaming">
          {glyph}
          <span className="project-card__body">
            <span className="project-card__key">{project.referenceKey}</span>
            <input
              className="project-card__name-input"
              aria-label={`Rename ${project.name}`}
              autoFocus
              maxLength={120}
              value={draftName}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== 'Escape') return;
                event.preventDefault();
                cancelRename.current = event.key === 'Escape';
                event.currentTarget.blur();
              }}
            />
            <small>Enter to save · Esc to cancel</small>
          </span>
        </div>
      )}
      {draftName === null ? (
        <div className="project-card__tools">
          <button
            className="project-card__tool"
            type="button"
            disabled={disabled || pending !== undefined}
            aria-label={`Rename ${project.name}`}
            onClick={startRename}
          >
            Rename
          </button>
          <button
            className="project-card__tool"
            type="button"
            disabled={disabled || pending !== undefined}
            aria-label={`Archive ${project.name}`}
            onClick={archive}
          >
            {pending?.kind === 'archive' ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      ) : null}
      {lifecycle.error ? (
        <p className="project-card__error" role="alert">
          {lifecycle.error.message}
        </p>
      ) : null}
    </article>
  );
}
