import type {
  ActivityChange,
  ActivityEntry,
  ActivityRun,
  ActivitySubject,
  NodeStatus
} from '@n2/contracts';
import { useState, type ReactNode } from 'react';
import type { NavigationIntent } from '../useCanvasNavigation.js';
import {
  actorLabel,
  formatActivityClock,
  formatRunSpan,
  kindLabels,
  placementLabel
} from '../activityPresentation.js';
import { nodeStatusLabels } from '../statusPresentation.js';

// Enough to read a run at a glance; a long agent run folds the rest behind "Show more".
const RUN_PREVIEW_ENTRIES = 4;

/** An entry's item links: following one, and whether that one still waits for the graph. */
type ItemLinks = { open: (nodeId: string) => void; isPending: (nodeId: string) => boolean };

/** Following a link, named by its entry and item; `link` only tells the waiting one apart. */
export type EntryLinks = {
  open: (nodeId: string, link: string) => void;
  pending: NavigationIntent | null;
};

function SubjectLink({ subject, links }: { subject: ActivitySubject; links: ItemLinks }) {
  const title = subject.title || `Untitled ${kindLabels[subject.kind].toLowerCase()}`;
  if (!subject.present) {
    return (
      <span className="activity-subject activity-subject--gone">
        {subject.reference ? (
          <span className="activity-subject__reference">{subject.reference}</span>
        ) : null}
        <span className="activity-subject__title">{title}</span>
      </span>
    );
  }
  const pending = links.isPending(subject.id);
  return (
    <button
      className={`activity-subject${pending ? ' activity-subject--pending' : ''}`}
      type="button"
      title={`Show ${subject.reference ?? title} on the canvas`}
      aria-busy={pending || undefined}
      onClick={() => links.open(subject.id)}
    >
      <span className="activity-subject__reference">{subject.reference}</span>
      <span className="activity-subject__title">{title}</span>
    </button>
  );
}

const StatusLabel = ({ status }: { status: NodeStatus }) => (
  <span className="activity-status">
    <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
    {nodeStatusLabels[status]}
  </span>
);

const attemptLabels = {
  claimed: 'An agent claimed it',
  progress: 'Agent reported progress',
  completed: 'Agent finished its attempt',
  failed: 'Agent attempt failed',
  released: 'Agent released it',
  stopped: 'Agent stopped as asked'
} satisfies Record<Extract<ActivityChange, { kind: 'attempt' }>['event'], string>;

function describeChange(
  change: ActivityChange,
  subject: ActivitySubject,
  links: ItemLinks
): ReactNode {
  switch (change.kind) {
    case 'created':
      return `Created ${kindLabels[subject.kind].toLowerCase()}`;
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      // The subject shows today's title, so each rename names where it went, not just where from.
      return change.from === null ? (
        `Renamed to “${change.to}”`
      ) : (
        <>
          Renamed “{change.from}” <span aria-label="to">→</span> “{change.to}”
        </>
      );
    case 'status_requested':
      return change.from === null ? (
        <>
          Set to <StatusLabel status={change.to} />
        </>
      ) : (
        <>
          <StatusLabel status={change.from} /> <span aria-label="to">→</span>{' '}
          <StatusLabel status={change.to} />
        </>
      );
    case 'text_edited':
      return `${subject.kind === 'note' ? 'Content' : 'Description'} edited${change.edits > 1 ? ` ×${change.edits}` : ''}`;
    case 'placement_changed':
      return `Planned: ${placementLabel(change.to)}`;
    case 'relationship': {
      const verb =
        change.relationship === 'member_of'
          ? change.change === 'added'
            ? 'Joined'
            : 'Left'
          : change.change === 'added'
            ? 'Now depends on'
            : 'No longer depends on';
      return (
        <>
          {verb} <SubjectLink subject={change.other} links={links} />
        </>
      );
    }
    case 'agent_eligibility':
      return change.enabled ? 'Enabled for agents' : 'Disabled for agents';
    case 'attempt':
      return (
        <>
          {attemptLabels[change.event]}
          {change.note ? <q className="activity-change__note">{change.note}</q> : null}
        </>
      );
  }
}

function EntryView({
  entry,
  entryKey,
  entryLinks
}: {
  entry: ActivityEntry;
  entryKey: string;
  entryLinks: EntryLinks;
}) {
  const linkKey = (nodeId: string) => `${entryKey}/${nodeId}`;
  const links: ItemLinks = {
    open: (nodeId) => entryLinks.open(nodeId, linkKey(nodeId)),
    isPending: (nodeId) => entryLinks.pending?.link === linkKey(nodeId)
  };
  return (
    <li className="activity-entry">
      <div className="activity-entry__head">
        <SubjectLink subject={entry.subject} links={links} />
        <time dateTime={entry.at}>{formatActivityClock(entry.at)}</time>
      </div>
      <ul className="activity-entry__changes">
        {entry.changes.map((change, index) => (
          <li key={index} className={`activity-change activity-change--${change.kind}`}>
            {describeChange(change, entry.subject, links)}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** One Activity Run. `heading` names where it happened when the feed spans Projects. */
export function RunView({
  run,
  now,
  entryLinks,
  heading = null
}: {
  run: ActivityRun;
  now: Date;
  entryLinks: EntryLinks;
  heading?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? run.entries : run.entries.slice(0, RUN_PREVIEW_ENTRIES);
  const hidden = run.entries.length - shown.length;
  const changes = run.entries.reduce((total, { commandCount }) => total + commandCount, 0);
  const actorKind = run.actor?.kind ?? 'unknown';
  return (
    <article
      className={`activity-run activity-run--${actorKind}${run.unseen ? ' activity-run--new' : ''}`}
    >
      {heading}
      <header className="activity-run__header">
        <span className="activity-run__mark" aria-hidden="true" />
        <span className="activity-run__actor">{actorLabel(run.actor)}</span>
        {run.actor?.kind === 'agent' ? <span className="activity-run__tag">Agent</span> : null}
        <time className="activity-run__span" dateTime={run.endedAt}>
          {formatRunSpan(run.startedAt, run.endedAt, now)}
        </time>
      </header>
      <p className="activity-run__summary">
        {run.entries.length} {run.entries.length === 1 ? 'item' : 'items'} · {changes}{' '}
        {changes === 1 ? 'change' : 'changes'}
      </p>
      <ol className="activity-run__entries">
        {shown.map((entry) => (
          <EntryView
            key={entry.subject.id}
            entry={entry}
            entryKey={`${run.firstSequence}/${entry.subject.id}`}
            entryLinks={entryLinks}
          />
        ))}
      </ol>
      {hidden > 0 ? (
        <button className="activity-run__more" type="button" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      ) : null}
    </article>
  );
}
