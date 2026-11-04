import type {
  ActivityChange,
  ActivityEntry,
  ActivityRun,
  ActivitySubject,
  CommandActor,
  LibraryActivity,
  LibraryActivityRun,
  LibrarySeenMarkers,
  MarkLibraryActivitySeenInput,
  NodeKind,
  Project,
  ProjectActivity,
  SeenMarker
} from '@n2/contracts';
import {
  readReceipts,
  replayRun,
  type ItemState,
  type PendingEntry,
  type ReadReceipt
} from './activityEntries.js';

/** One applied Project Command as Project Activity reads it. */
export type StoredCommandReceipt = {
  sequence: number;
  /** The canonical command document the receipt was fingerprinted from. */
  fingerprint: string;
  actor: CommandActor | null;
  createdAt: string;
  /** The reserved Reference and kind of the Canvas Item a node command targets, kept after deletion. */
  itemReference: string | null;
  itemKind: NodeKind | null;
};

/** The append-only record Project Activity is read from. */
export type ActivityHistory = {
  receipts: StoredCommandReceipt[];
  /**
   * Every Enablement reserved in the Project. Unlike an eligibility row, a reservation survives
   * the Task and later Enablements, so it shows whether a Task was enabled before its receipts.
   */
  enablements: { enablementId: string; taskId: string }[];
};

export interface ActivityStore {
  getActivityHistory(projectId: string): ActivityHistory;
  /** The sequence of the newest Command Receipt, or 0 before any. */
  getLatestSequence(projectId: string): number;
  getSeenMarker(projectId: string): SeenMarker | null;
  /** Moves the Seen Marker forward only. Looking is not a Project Command, even when archived. */
  markActivitySeen(projectId: string, sequence: number, seenAt: string): SeenMarker;
  /**
   * Moves several Projects' Seen Markers by the same rule in one transaction. An unknown Project
   * rejects the batch; an archived one is skipped and reported by its absence.
   */
  markLibraryActivitySeen(
    marks: MarkLibraryActivitySeenInput['projects'],
    seenAt: string
  ): LibrarySeenMarkers;
}

export interface ActivityUseCases {
  queryActivity(projectId: string): ProjectActivity;
  queryLibraryActivity(): LibraryActivity;
  markActivitySeen(projectId: string, sequence: number): SeenMarker;
  markLibraryActivitySeen(input: MarkLibraryActivitySeenInput): LibrarySeenMarkers;
}

type ActivityReader = ActivityStore & {
  getProject(projectId: string): Project;
  listProjects(query: { includeArchived: boolean }): { id: string }[];
};

// A quiet stretch this long ends an Activity Run even when the same actor carries on.
export const RUN_IDLE_GAP_MS = 20 * 60 * 1000;
// Runs that are not new, shown beside the new ones, so the feed never opens onto nothing.
const SEEN_CONTEXT_RUNS = 5;

const actorKey = (actor: CommandActor | null): string =>
  actor === null ? 'unknown' : actor.kind === 'person' ? 'person' : `agent:${actor.name}`;

type RunDraft = {
  actor: CommandActor | null;
  receipts: ReadReceipt[];
};

const splitRuns = (read: readonly ReadReceipt[], seenSequence: number): RunDraft[] => {
  const runs: RunDraft[] = [];
  let current: RunDraft | null = null;
  for (const item of read) {
    if (item.touches.length === 0) continue;
    const last = current?.receipts.at(-1)?.receipt;
    const continues =
      current !== null &&
      last !== undefined &&
      actorKey(current.actor) === actorKey(item.receipt.actor) &&
      Date.parse(item.receipt.createdAt) - Date.parse(last.createdAt) <= RUN_IDLE_GAP_MS &&
      // A run never straddles the Seen Marker, so "new" is always whole runs.
      last.sequence > seenSequence === item.receipt.sequence > seenSequence;
    if (current !== null && continues) {
      current.receipts.push(item);
    } else {
      current = { actor: item.receipt.actor, receipts: [item] };
      runs.push(current);
    }
  }
  return runs;
};

/**
 * Whether a run is new to the Person: after the Seen Marker, and not their own, since their own
 * changes are never news to them. The one rule behind the count, which history is returned, and
 * which runs the sheet lists as new.
 */
/**
 * Every new run, then a few runs that are not new for context. Closing a feed acknowledges what it
 * loaded, so a new run is never cut; the Person's own busy afternoon never makes a feed unbounded.
 */
const withRecentContext = <Run extends ActivityRun>(runs: readonly Run[]) => {
  let context = 0;
  const shown = runs.filter(({ unseen }) => unseen || context++ < SEEN_CONTEXT_RUNS);
  return { runs: shown, hasEarlier: runs.length > shown.length };
};

const isUnseen = (actor: CommandActor | null, firstSequence: number, seenSequence: number) =>
  firstSequence > seenSequence && actor?.kind !== 'person';

const toRun = (
  run: RunDraft,
  pending: readonly PendingEntry[],
  subjectOf: (id: string) => ActivitySubject,
  seenSequence: number
): ActivityRun | null => {
  const first = run.receipts[0]?.receipt;
  const last = run.receipts.at(-1)?.receipt;
  if (pending.length === 0 || !first || !last) return null;
  const entries = pending
    .map(({ subjectId, lastSequence, at, commandCount, changes }): ActivityEntry => ({
      subject: subjectOf(subjectId),
      lastSequence,
      at,
      commandCount,
      changes: changes.map((change): ActivityChange => {
        if (change.kind !== 'relationship') return change;
        const { otherId, ...relationship } = change;
        return { ...relationship, other: subjectOf(otherId) };
      })
    }))
    .sort((left, right) => right.lastSequence - left.lastSequence);
  return {
    actor: run.actor,
    startedAt: first.createdAt,
    endedAt: last.createdAt,
    firstSequence: first.sequence,
    lastSequence: last.sequence,
    unseen: isUnseen(run.actor, first.sequence, seenSequence),
    entries
  };
};

/**
 * Project Activity: what changed in a Project, newest first, as Activity Runs of net
 * Activity Entries, split at the Seen Marker. Pure; reading it never writes anything.
 */
export const deriveProjectActivity = (
  project: Project,
  history: ActivityHistory,
  seen: SeenMarker | null
): ProjectActivity => {
  const ordered = [...history.receipts].sort((left, right) => left.sequence - right.sequence);
  const { read, origins } = readReceipts(project, { ...history, receipts: ordered });
  const seenSequence = seen?.sequence ?? 0;
  const states = new Map<string, ItemState>();
  const replayed = splitRuns(read, seenSequence).map((run) => ({
    run,
    pending: replayRun(run.receipts, states, origins)
  }));
  const present = new Map(project.nodes.map((node) => [node.id, node]));
  // Every subject, an entry's own or a relationship's other item, is resolved here, after the whole
  // replay, so all of them read as of `latestSequence`. Present items show their current Reference
  // and title; deleted ones keep their reserved Reference and kind and their last known title.
  const subjectOf = (id: string): ActivitySubject => {
    const node = present.get(id);
    if (node) {
      return { id, reference: node.reference, title: node.title, kind: node.kind, present: true };
    }
    const known = states.get(id);
    return {
      id,
      reference: origins.references.get(id) ?? null,
      title: known?.title ?? '',
      // An item whose kind storage never recorded shows as a Task, the commonest kind.
      kind: origins.kinds.get(id) ?? 'task',
      present: false
    };
  };

  const runs = replayed
    .map(({ run, pending }) => toRun(run, pending, subjectOf, seenSequence))
    .filter((run): run is ActivityRun => run !== null)
    .reverse();
  const shown = withRecentContext(runs);
  const unseenItems = new Set(
    runs
      .filter(({ unseen }) => unseen)
      .flatMap(({ entries }) => entries.map(({ subject }) => subject.id))
  );
  return {
    projectId: project.id,
    latestSequence: ordered.at(-1)?.sequence ?? 0,
    seen,
    unseenItemCount: unseenItems.size,
    ...shown
  };
};

export const projectActivity = (store: ActivityReader, projectId: string): ProjectActivity =>
  deriveProjectActivity(
    store.getProject(projectId),
    store.getActivityHistory(projectId),
    store.getSeenMarker(projectId)
  );

/**
 * Library Activity: each unarchived Project read once, exactly as its own sheet reads it, merged
 * newest first. Archived Projects are put away, so their activity waits until they are restored.
 */
export const libraryActivity = (store: ActivityReader): LibraryActivity => {
  const projects = store
    .listProjects({ includeArchived: false })
    .map(({ id }) => projectActivity(store, id));
  // Receipt sequences are per Project, so time is the only order runs from two Projects share.
  const runs = projects
    .flatMap(({ projectId, runs }) =>
      runs.map((run): LibraryActivityRun => ({ projectId, ...run }))
    )
    .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));
  const shown = withRecentContext(runs);
  return {
    projects: projects.map(({ projectId, latestSequence, seen, unseenItemCount }) => ({
      projectId,
      latestSequence,
      seen,
      unseenItemCount
    })),
    runs: shown.runs,
    hasEarlier: shown.hasEarlier || projects.some(({ hasEarlier }) => hasEarlier)
  };
};
