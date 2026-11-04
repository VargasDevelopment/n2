import {
  isWorkNode,
  type NodeStatus,
  type ProjectedNode,
  type ProjectedWorkNode
} from '@n2/contracts';
import { useRef } from 'react';
import { kindLabels } from '../activityPresentation.js';
import type { DirectlyRelatedWorkNode, DirectRelationships } from '../directRelationships.js';
import { nodeStatusLabels, relationshipBlockers } from '../statusPresentation.js';
import { useEditMode, useFocusAtEnd, useSavedText } from './inspectorEditing.js';
import type { RelatedWork } from './InspectorRelationships.js';
import './InspectorFace.css';

const normalizeTitleDraft = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/gu, ' ');

/**
 * The title reads as a heading and becomes a field on click. Enter or click-away saves; Escape
 * cancels, as it does on a card.
 */
function TitleField({
  title,
  persist
}: {
  title: string;
  persist: (draft: string) => Promise<string | null>;
}) {
  const draft = useSavedText(title, persist);
  const { editing, returnTo, start, stop } = useEditMode<HTMLButtonElement>();
  const focusAtEnd = useFocusAtEnd();
  const cancelled = useRef(false);

  if (!editing) {
    return (
      <h2 className="inspector__title">
        <button
          ref={returnTo}
          type="button"
          className="inspector__title-text"
          title="Click to edit"
          onClick={start}
        >
          {draft.draft}
        </button>
      </h2>
    );
  }
  return (
    <textarea
      ref={focusAtEnd}
      className="inspector__title inspector__title-input"
      aria-label="Title"
      value={draft.draft}
      rows={1}
      wrap="soft"
      maxLength={240}
      onChange={(event) => draft.edit(normalizeTitleDraft(event.currentTarget.value))}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') cancelled.current = true;
        else if (event.key !== 'Enter') return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
      onBlur={() => {
        const returnFocus = cancelled.current;
        if (cancelled.current) draft.cancel();
        else void draft.save();
        cancelled.current = false;
        stop(returnFocus);
      }}
    />
  );
}

type Blockers = { first: DirectlyRelatedWorkNode; viaMember: boolean } | null;

// Blockers list blocked dependencies, then blocked members; the first one found is named.
const firstBlocker = (
  blockers: readonly string[],
  items: DirectRelationships | undefined
): Blockers => {
  const [blockerId] = blockers;
  if (!items || blockerId === undefined) return null;
  const dependency = items.dependencies.find((entry) => entry.node.id === blockerId);
  if (dependency) return { first: dependency, viaMember: false };
  const member = items.members.find((entry) => entry.node.id === blockerId);
  return member ? { first: member, viaMember: true } : null;
};

/** The effective status, and when relationships block it, which work does. */
function WorkState({
  node,
  relationships
}: {
  node: ProjectedWorkNode;
  relationships: RelatedWork | undefined;
}) {
  const blockers = relationshipBlockers(node);
  const blocker = firstBlocker(blockers, relationships?.items);
  // A blocker that is both a dependency and a member is listed twice but is one piece of work.
  const others = new Set(blockers).size - 1;
  return (
    <p className="inspector__state">
      <span className="inspector__chip" data-status={node.effectiveStatus}>
        <span className={`status-dot status-dot--${node.effectiveStatus}`} aria-hidden="true" />
        {nodeStatusLabels[node.effectiveStatus]}
      </span>
      {blocker && relationships ? (
        <span className="inspector__blocker">
          by {blocker.viaMember ? 'member ' : ''}
          <button
            type="button"
            className="inspector__link"
            disabled={!blocker.first.isVisible}
            title={blocker.first.isVisible ? undefined : 'Hidden in this view'}
            onClick={() => relationships.onNavigate(blocker.first.node.id)}
          >
            <span className="inspector__reference">{blocker.first.node.reference}</span>{' '}
            {blocker.first.node.title}
          </button>
          {others > 0 ? ` and ${others} more` : null}
        </span>
      ) : null}
    </p>
  );
}

const countOrder: readonly NodeStatus[] = ['done', 'in_progress', 'blocked', 'ready'];

/** A Group's progress: the average of its direct members, and how many sit in each status. */
function GroupProgress({
  node,
  counts
}: {
  node: ProjectedWorkNode;
  counts: Record<NodeStatus, number>;
}) {
  const percent = Math.round(node.progress * 100);
  return (
    <div className="inspector__progress">
      <strong>{percent}%</strong>
      <div
        className="inspector__track"
        role="progressbar"
        aria-label="Group progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${node.progress * 100}%` }} />
      </div>
      <p>
        {countOrder.map((status) =>
          counts[status] > 0 ? (
            <span key={status}>
              <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
              {counts[status]} {nodeStatusLabels[status].toLowerCase()}
            </span>
          ) : null
        )}
      </p>
    </div>
  );
}

const memberCounts = (members: readonly DirectlyRelatedWorkNode[]): Record<NodeStatus, number> => {
  const counts = { ready: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const { node } of members) counts[node.effectiveStatus] += 1;
  return counts;
};

/**
 * The top of the panel is the selected card, larger: its kind, reference, title and status read
 * as they do on the canvas, so the card and its details look like one object.
 */
export function InspectorFace({
  node,
  relationships,
  onClose,
  persistTitle
}: {
  node: ProjectedNode;
  relationships: RelatedWork | undefined;
  onClose: () => void;
  persistTitle: (draft: string) => Promise<string | null>;
}) {
  const work = isWorkNode(node) ? node : null;
  return (
    <header className="inspector__face" data-kind={node.kind} data-status={work?.effectiveStatus}>
      <div className="inspector__eyebrow">
        {node.kind === 'note' ? <span className="inspector__note-mark">✦</span> : null}
        <span>{kindLabels[node.kind]}</span>
        <span aria-hidden="true">·</span>
        <span className="inspector__reference">{node.reference}</span>
        <button
          type="button"
          className="inspector__close"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </div>
      <TitleField title={node.title} persist={persistTitle} />
      {work ? <WorkState node={work} relationships={relationships} /> : null}
      {work?.kind === 'group' ? (
        <GroupProgress node={work} counts={memberCounts(relationships?.items.members ?? [])} />
      ) : null}
    </header>
  );
}
