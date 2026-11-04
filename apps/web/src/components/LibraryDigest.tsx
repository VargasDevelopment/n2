import type { CommandActor, LibraryActivity, ProjectSummary } from '@n2/contracts';
import {
  formatActivityClock,
  formatActivityDay,
  formatActors,
  type DigestRow
} from '../activityPresentation.js';
import './LibraryDigest.css';

const markKind = (actor: CommandActor | null | undefined): string => actor?.kind ?? 'unknown';

/**
 * "Since you last looked": which Projects changed, and by whom. It names where, never what; each
 * row opens that Project's own Activity sheet, and the feed across Projects opens from the heading.
 * Hidden until there is activity to speak of, so a new Library is not greeted by an empty digest.
 */
export function LibraryDigest({
  activity,
  digest,
  projects,
  feedOpen,
  inert,
  onOpenFeed,
  onOpenProjectActivity
}: {
  activity: LibraryActivity | undefined;
  digest: readonly DigestRow[];
  /** Unarchived Projects, by which the digest names them. */
  projects: readonly ProjectSummary[];
  feedOpen: boolean;
  /** Set while a Project draft is open, like the Project list beside it. */
  inert: boolean;
  onOpenFeed: () => void;
  onOpenProjectActivity: (projectId: string) => void;
}) {
  if (!activity || activity.runs.length === 0) return null;
  const summaries = new Map(projects.map((project) => [project.id, project]));
  const rows = digest.flatMap((row) => {
    const project = summaries.get(row.projectId);
    return project ? [{ ...row, project }] : [];
  });
  const now = new Date();
  return (
    <section className="library-digest" aria-labelledby="library-digest-heading" inert={inert}>
      <header className="library-digest__header">
        <h2 id="library-digest-heading">Since you last looked</h2>
        <span className="library-digest__rule" aria-hidden="true" />
        <button
          type="button"
          className="library-digest__feed"
          aria-pressed={feedOpen}
          onClick={onOpenFeed}
        >
          All activity
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="library-digest__caught-up">
          <span className="library-digest__caught-up-mark" aria-hidden="true" />
          You’re caught up. Nothing new in any Project.
        </p>
      ) : (
        <ul className="library-digest__rows">
          {rows.map(({ project, unseenItemCount, actors, latestAt }) => (
            <li key={project.id}>
              <button
                type="button"
                className={`library-digest__row library-digest__row--${markKind(actors[0])}`}
                onClick={() => onOpenProjectActivity(project.id)}
              >
                <span className="library-digest__mark" aria-hidden="true" />
                <span className="library-digest__key">{project.referenceKey}</span>
                <span className="library-digest__name">{project.name}</span>
                <span className="library-digest__who">
                  {unseenItemCount} {unseenItemCount === 1 ? 'item' : 'items'} changed by{' '}
                  {formatActors(actors)}
                </span>
                <time className="library-digest__when" dateTime={latestAt}>
                  {formatActivityDay(latestAt, now)} {formatActivityClock(latestAt)}
                </time>
                <span className="library-digest__open">
                  Open what changed <span aria-hidden="true">→</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
