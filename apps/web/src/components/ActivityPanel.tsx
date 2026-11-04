import type { ProjectActivity } from '@n2/contracts';
import type { ActivitySession } from '../activityQueries.js';
import type { NavigationIntent } from '../useCanvasNavigation.js';
import { formatActivityClock, formatActivityDay } from '../activityPresentation.js';
import { ActivitySheet } from './ActivitySheet.js';
import { RunView, type EntryLinks } from './ActivityRuns.js';
import './ActivityPanel.css';

const sinceLabel = (activity: ProjectActivity, now: Date): string => {
  if (activity.seen === null) return 'Changes by you and by agents, newest first';
  const day = formatActivityDay(activity.seen.seenAt, now);
  const when = `${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`} at ${formatActivityClock(activity.seen.seenAt)}`;
  if (activity.unseenItemCount === 0) return `You last looked ${when}`;
  const items = activity.unseenItemCount === 1 ? 'item' : 'items';
  return `${activity.unseenItemCount} ${items} changed since you looked ${when}`;
};

/** The topbar control that opens Project Activity and counts what is new since the last look. */
export function ActivityEntryPoint({ session }: { session: ActivitySession }) {
  const count = session.open ? 0 : (session.activity?.unseenItemCount ?? 0);
  return (
    <button
      type="button"
      className="activity-entry-point"
      aria-pressed={session.open}
      onClick={session.toggle}
    >
      <span aria-hidden="true">◷</span>
      Activity
      {count > 0 ? (
        <span className="activity-count" aria-label={`${count} new`}>
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  );
}

/** Project Activity: what changed, newest first, with everything since the Seen Marker on top. */
export function ActivityPanel({
  session: { activity, close: onClose },
  onOpenItem: navigate,
  pendingItem = null
}: {
  session: ActivitySession;
  onOpenItem: (intent: NavigationIntent) => void;
  /** The link whose item the canvas is still waiting for, if any; it shows as busy. */
  pendingItem?: NavigationIntent | null;
}) {
  const entryLinks: EntryLinks = {
    open: (nodeId, link) =>
      navigate({
        nodeId,
        // The panel holds the right edge, so an item opened from it keeps its Inspector off it.
        placement: 'left',
        // Every link, an older entry's or a relationship's, shows the item as of this response:
        // its current title and presence. So each waits for a graph at least as new as the response.
        sequence: activity?.latestSequence ?? 0,
        link
      }),
    pending: pendingItem
  };
  const now = new Date();
  return (
    <ActivitySheet
      label="Project activity"
      summary={activity ? sinceLabel(activity, now) : 'Reading activity…'}
      runs={activity?.runs}
      hasEarlier={activity?.hasEarlier ?? false}
      emptyHint="Changes made here or by agents will show up in this list."
      renderRun={(run) => (
        <RunView key={run.firstSequence} run={run} now={now} entryLinks={entryLinks} />
      )}
      onClose={onClose}
    />
  );
}
