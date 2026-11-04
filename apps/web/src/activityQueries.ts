import type { LibraryActivity, ProjectActivity } from '@n2/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import * as api from './api.js';
import { executionQueryKey, projectQueryKey } from './useProjectCommands.js';

const PROJECT_ACTIVITY_QUERY_ROOT = 'project-activity';
export const activityQueryKey = (projectId: string) =>
  [PROJECT_ACTIVITY_QUERY_ROOT, projectId] as const;
export const LIBRARY_ACTIVITY_QUERY_KEY = ['library-activity'] as const;

// Agents write while the person watches; a slow poll keeps the badge honest without a socket.
const ACTIVITY_POLL_MS = 30_000;

/**
 * Project Activity for one Project. `graphSequence` is the newest command the loaded graph
 * reflects. Whenever Activity shows a newer one, on its first load or any poll, the graph and
 * execution queries are refreshed, so following an entry never lands on a stale canvas.
 */
export function useProjectActivity(projectId: string, graphSequence: number | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: activityQueryKey(projectId),
    queryFn: () => api.getActivity(projectId),
    refetchInterval: ACTIVITY_POLL_MS
  });
  const latestSequence = query.data?.latestSequence;
  useEffect(() => {
    // A graph still loading will be fresh when it lands; this runs again once it does.
    if (latestSequence === undefined || graphSequence === undefined) return;
    if (latestSequence <= graphSequence) return;
    void queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId), exact: true });
    void queryClient.invalidateQueries({ queryKey: executionQueryKey(projectId), exact: true });
  }, [graphSequence, latestSequence, projectId, queryClient]);

  const markSeen = useCallback(
    async (activity: ProjectActivity): Promise<void> => {
      if (activity.latestSequence <= (activity.seen?.sequence ?? 0)) return;
      await api.markActivitySeen(projectId, activity.latestSequence);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: activityQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: LIBRARY_ACTIVITY_QUERY_KEY })
      ]);
    },
    [projectId, queryClient]
  );
  return { activity: query.data, markSeen };
}

/** Library Activity: the digest, the card counts and the Library feed all read this one query. */
export function useLibraryActivity() {
  return useQuery({
    queryKey: LIBRARY_ACTIVITY_QUERY_KEY,
    queryFn: api.getLibraryActivity,
    refetchInterval: ACTIVITY_POLL_MS
  }).data;
}

/** The snapshot without the Projects the Library no longer lists, or itself when none dropped. */
const withoutUnlisted = (
  snapshot: LibraryActivity,
  listed: ReadonlySet<string>
): LibraryActivity => {
  const projects = snapshot.projects.filter(({ projectId }) => listed.has(projectId));
  const runs = snapshot.runs.filter(({ projectId }) => listed.has(projectId));
  return projects.length === snapshot.projects.length && runs.length === snapshot.runs.length
    ? snapshot
    : { ...snapshot, projects, runs };
};

/** What closing a feed acknowledges: each Project it shows news for, as far as it was read. */
const acknowledgement = (feed: LibraryActivity) =>
  feed.projects
    .filter(({ unseenItemCount }) => unseenItemCount > 0)
    .map(({ projectId, latestSequence }) => ({ projectId, sequence: latestSequence }));

type FeedSession = { open: false } | { open: true; snapshot: LibraryActivity | undefined };

/**
 * The Library feed, open or closed. Closing acknowledges exactly the session's snapshot: the
 * response it opened onto, never a later poll, so activity that lands while the Person reads stays
 * new for the digest and the next open. The snapshot only shrinks: a Project the Library stops
 * listing is cut from it for good, so restoring that Project before closing does not bring it back.
 * Leaving any other way, such as following a link into a Project, acknowledges nothing, as with a
 * Project's own sheet. `listed` is the Library's unarchived Projects, the one source of archive
 * state (ADR 0012), or undefined until the Library has loaded.
 */
export function useLibraryActivitySession(listed: ReadonlySet<string> | undefined) {
  const queryClient = useQueryClient();
  const live = useLibraryActivity();
  const [session, setSession] = useState<FeedSession>({ open: false });
  if (session.open) {
    // A feed opened before the first response reads that response, and then holds it.
    const snapshot = session.snapshot ?? live;
    const reduced = snapshot && listed ? withoutUnlisted(snapshot, listed) : snapshot;
    if (reduced !== session.snapshot) setSession({ open: true, snapshot: reduced });
  }
  const feed = session.open ? session.snapshot : undefined;
  const close = useCallback((): void => {
    setSession({ open: false });
    const projects = feed ? acknowledgement(feed) : [];
    if (projects.length === 0) return;
    // A failed write leaves the markers where they were, so the same activity is new again later.
    api
      .markLibraryActivitySeen({ projects })
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: LIBRARY_ACTIVITY_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: [PROJECT_ACTIVITY_QUERY_ROOT] })
        ])
      )
      .catch(() => undefined);
  }, [feed, queryClient]);
  const toggle = useCallback(
    (): void => (session.open ? close() : setSession({ open: true, snapshot: live })),
    [close, live, session.open]
  );
  return { live, feed, open: session.open, close, toggle };
}
export type LibraryActivitySession = ReturnType<typeof useLibraryActivitySession>;

/**
 * Whether Project Activity is open in this workspace. Closing it is what moves the Seen Marker, so
 * the "new" divider stays put while the person is still reading. `onClose` hears every way it closes.
 */
export function useActivitySession(
  projectId: string,
  graphSequence: number | undefined,
  onClose: () => void = () => undefined,
  /** Arriving from the Library digest opens the sheet straight away. */
  initiallyOpen = false
) {
  const { activity, markSeen } = useProjectActivity(projectId, graphSequence);
  const [open, setOpen] = useState(initiallyOpen);
  const close = useCallback((): void => {
    setOpen(false);
    onClose();
    // A failed write leaves the marker where it was, so the same activity is new again next time.
    if (activity) markSeen(activity).catch(() => undefined);
  }, [activity, markSeen, onClose]);
  const toggle = useCallback((): void => (open ? close() : setOpen(true)), [close, open]);
  return { activity, open, close, toggle };
}
export type ActivitySession = ReturnType<typeof useActivitySession>;
