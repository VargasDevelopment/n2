import type {
  CommandActor,
  LibraryActivity,
  LibraryActivityProject,
  NodeKind,
  PlanningPlacement
} from '@n2/contracts';

export const actorLabel = (actor: CommandActor | null): string =>
  actor === null ? 'Unattributed' : actor.kind === 'person' ? 'You' : actor.name;

export const kindLabels = {
  task: 'Task',
  group: 'Group',
  note: 'Note'
} satisfies Record<NodeKind, string>;

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const planningDay = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

const startOfDay = (value: Date): number =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

/** Today shows a time, yesterday says so, anything older shows its date. */
export const formatActivityDay = (at: string, now: Date): string => {
  const date = new Date(at);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return day.format(date);
};

export const formatActivityClock = (at: string): string => clock.format(new Date(at));

export const formatRunSpan = (startedAt: string, endedAt: string, now: Date): string => {
  const start = formatActivityClock(startedAt);
  const end = formatActivityClock(endedAt);
  return `${formatActivityDay(endedAt, now)} · ${start === end ? start : `${start}–${end}`}`;
};

// Planning Dates are calendar days, so they are formatted without the local time zone.
const planningDate = (date: string): string => planningDay.format(new Date(`${date}T00:00:00Z`));

export const placementLabel = (placement: PlanningPlacement | null): string =>
  placement === null
    ? 'Unscheduled'
    : placement.kind === 'milestone'
      ? `Milestone ${planningDate(placement.date)}`
      : `${planningDate(placement.startDate)} – ${planningDate(placement.endDate)}`;

/**
 * Where each Project in a Library Activity response was read. The schema makes every run name a
 * listed Project, so a miss is a broken contract and throws rather than defaulting.
 */
export const libraryProjectLookup = (projects: readonly LibraryActivityProject[]) => {
  const byId = new Map(projects.map((project) => [project.projectId, project]));
  return (projectId: string): LibraryActivityProject => {
    const project = byId.get(projectId);
    if (!project) throw new Error(`Library Activity does not list Project ${projectId}.`);
    return project;
  };
};

/** One Project in the Library digest: where something changed since the Person last looked. */
export type DigestRow = {
  projectId: string;
  unseenItemCount: number;
  /** Who changed it, newest first, each once; null is Unattributed. Never the Person. */
  actors: (CommandActor | null)[];
  latestAt: string;
};

const actorKey = (actor: CommandActor | null): string =>
  actor === null ? 'unattributed' : actor.kind === 'person' ? 'person' : `agent:${actor.name}`;

/**
 * The Projects with new activity, the most recently changed first. Read from the runs the server
 * marked unseen, so the digest, the cards and the feed agree on what is new.
 */
export const libraryDigest = (activity: LibraryActivity): DigestRow[] => {
  const projectOf = libraryProjectLookup(activity.projects);
  const rows = new Map<string, DigestRow>();
  for (const { projectId, actor, endedAt, unseen } of activity.runs) {
    if (!unseen) continue;
    const row = rows.get(projectId) ?? {
      projectId,
      unseenItemCount: projectOf(projectId).unseenItemCount,
      actors: [],
      latestAt: endedAt
    };
    if (!row.actors.some((known) => actorKey(known) === actorKey(actor))) row.actors.push(actor);
    rows.set(projectId, row);
  }
  return [...rows.values()];
};

/** "codex-review", "codex-review and example-lead", or "codex-review, example-lead and 2 others". */
export const formatActors = (actors: readonly (CommandActor | null)[]): string => {
  const names = actors.map(actorLabel);
  if (names.length <= 2) return names.join(' and ');
  const others = names.length - 2;
  return `${names.slice(0, 2).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`;
};
