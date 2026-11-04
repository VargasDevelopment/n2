import type { ProjectSummary } from '@n2/contracts';
import { useId, useState } from 'react';
import { usePendingLifecycleChange, useProjectLifecycle } from '../projectLibraryQueries.js';
import './ArchivedProjects.css';

const archivedDate = (archivedAt: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(archivedAt));

export function ArchivedProjects({
  projects,
  disabled
}: {
  projects: readonly ProjectSummary[];
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (projects.length === 0) return null;

  return (
    <section className="archived-projects">
      <button
        className="archived-projects__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="archived-projects__chevron" aria-hidden="true">
          ›
        </span>
        Archived
        <span className="archived-projects__count">{projects.length}</span>
      </button>
      {expanded ? (
        <ul className="archived-projects__list" id={listId} aria-label="Archived Projects">
          {projects.map((project) => (
            <ArchivedProjectRow key={project.id} project={project} disabled={disabled} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ArchivedProjectRow({ project, disabled }: { project: ProjectSummary; disabled: boolean }) {
  const lifecycle = useProjectLifecycle();
  const pending = usePendingLifecycleChange(project.id);
  return (
    <li className="archived-project">
      <span className="archived-project__key">{project.referenceKey}</span>
      <span className="archived-project__body">
        <strong>{project.name}</strong>
        <small>
          {project.archivedAt ? (
            <>
              Archived <time dateTime={project.archivedAt}>{archivedDate(project.archivedAt)}</time>
              {' · '}
            </>
          ) : null}
          {project.canvasItemCount} canvas {project.canvasItemCount === 1 ? 'item' : 'items'}
        </small>
        {lifecycle.error ? (
          <span className="archived-project__error" role="alert">
            {lifecycle.error.message}
          </span>
        ) : null}
      </span>
      <button
        className="archived-project__restore"
        type="button"
        disabled={disabled || pending !== undefined}
        aria-label={`Restore ${project.name}`}
        onClick={() => lifecycle.mutate({ kind: 'restore', projectId: project.id })}
      >
        {pending?.kind === 'restore' ? 'Restoring…' : 'Restore'}
      </button>
    </li>
  );
}
