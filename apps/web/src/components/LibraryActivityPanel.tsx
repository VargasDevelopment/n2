import type { LibraryActivity, ProjectSummary } from '@n2/contracts';
import { libraryProjectLookup } from '../activityPresentation.js';
import type { LibraryActivitySession } from '../activityQueries.js';
import type { ProjectArrival } from '../appLocation.js';
import { ActivitySheet } from './ActivitySheet.js';
import { RunView } from './ActivityRuns.js';

const libraryLabel = (activity: LibraryActivity): string => {
  const changed = activity.projects.filter(({ unseenItemCount }) => unseenItemCount > 0);
  if (changed.length === 0) {
    return activity.runs.length === 0
      ? 'Changes in every Project, by you and by agents'
      : 'Nothing new in any Project since you last looked';
  }
  const items = changed.reduce((total, { unseenItemCount }) => total + unseenItemCount, 0);
  return `${items} ${items === 1 ? 'item' : 'items'} changed in ${changed.length} ${
    changed.length === 1 ? 'Project' : 'Projects'
  } since you last looked`;
};

/**
 * Library Activity: every unarchived Project's runs in one sheet, each headed by its Project. An
 * item link opens its Project focused on the item; a Project heading opens that Project's own sheet.
 */
export function LibraryActivityPanel({
  session: { feed: activity, close },
  projects,
  onOpenProject
}: {
  session: LibraryActivitySession;
  /** The Library's summaries, the one source of Project names (ADR 0012). */
  projects: readonly ProjectSummary[];
  onOpenProject: (projectId: string, arrival: ProjectArrival) => void;
}) {
  const now = new Date();
  const summaries = new Map(projects.map((project) => [project.id, project]));
  // Before the response lands there are no runs, so nothing is joined.
  const projectOf = libraryProjectLookup(activity?.projects ?? []);
  return (
    <ActivitySheet
      label="Library activity"
      summary={activity ? libraryLabel(activity) : 'Reading activity…'}
      runs={activity?.runs}
      hasEarlier={activity?.hasEarlier ?? false}
      emptyHint="Changes in any Project, by you or by agents, will show up in this list."
      renderRun={(run) => {
        const project = summaries.get(run.projectId);
        const { latestSequence } = projectOf(run.projectId);
        return (
          <RunView
            key={`${run.projectId}/${run.firstSequence}`}
            run={run}
            now={now}
            // The feed is left behind, so no link waits here; the Project shows its own progress.
            entryLinks={{
              open: (nodeId) =>
                onOpenProject(run.projectId, {
                  kind: 'item',
                  nodeId,
                  sequence: latestSequence
                }),
              pending: null
            }}
            heading={
              <button
                type="button"
                className="activity-run__project"
                title={`Open what changed in ${project?.name ?? 'this Project'}`}
                onClick={() => onOpenProject(run.projectId, { kind: 'activity' })}
              >
                <span className="activity-run__project-key">{project?.referenceKey}</span>
                <span className="activity-run__project-name">{project?.name ?? 'Project'}</span>
              </button>
            }
          />
        );
      }}
      onClose={close}
    />
  );
}
