import { useState } from 'react';
import type { DirectlyRelatedWorkNode, DirectRelationships } from '../directRelationships.js';
import { nodeStatusLabels } from '../statusPresentation.js';
import './InspectorRelationships.css';

// Each role names its own removal, so the control says what will change in domain words.
const sections: ReadonlyArray<{
  key: keyof DirectRelationships;
  label: string;
  removeLabel: string;
}> = [
  { key: 'dependencies', label: 'Depends on', removeLabel: 'Stop depending on' },
  { key: 'dependents', label: 'Dependents', removeLabel: 'Remove dependent' },
  { key: 'groups', label: 'Part of', removeLabel: 'Remove from' },
  { key: 'members', label: 'Members', removeLabel: 'Remove member' }
];

/** Rows shown per role before the rest fold behind an expander, so long lists stay scannable. */
export const RELATED_ROWS_SHOWN = 6;

/**
 * A Work Node's direct relationships, how choosing one navigates to it, and how one is removed.
 * The Inspector is where relationships are managed while their lines rest quiet on the canvas.
 */
export type RelatedWork = {
  items: DirectRelationships;
  onNavigate: (nodeId: string) => void;
  onRemove: (relationshipId: string) => Promise<void>;
};

// Only these roles can block the subject: a blocked dependency, or a blocked member of a Group.
const blockingRoles: ReadonlySet<keyof DirectRelationships> = new Set(['dependencies', 'members']);

/**
 * Blocking rows lead. Past the first few rows the rest fold away; a Group's done members always
 * fold, since they need no more attention.
 */
const arrangeRows = (
  key: keyof DirectRelationships,
  entries: readonly DirectlyRelatedWorkNode[],
  isBlocking: (entry: DirectlyRelatedWorkNode) => boolean
): { rows: DirectlyRelatedWorkNode[]; open: number } => {
  const foldsDone = key === 'members';
  const isDone = (entry: DirectlyRelatedWorkNode) =>
    foldsDone && entry.node.effectiveStatus === 'done';
  const blocking = entries.filter(isBlocking);
  const rest = entries.filter((entry) => !isBlocking(entry) && !isDone(entry));
  const done = entries.filter(isDone);
  return {
    rows: [...blocking, ...rest, ...done],
    open: Math.min(blocking.length + rest.length, RELATED_ROWS_SHOWN)
  };
};

function RelatedWorkRow({
  entry,
  blocking,
  removeLabel,
  onSelect,
  onRemove
}: {
  entry: DirectlyRelatedWorkNode;
  blocking: boolean;
  removeLabel: string;
  onSelect: (nodeId: string) => void;
  onRemove: (relationshipId: string) => Promise<void>;
}) {
  const { node, isVisible } = entry;
  const status = nodeStatusLabels[node.effectiveStatus];
  const removal = `${removeLabel} ${node.reference} ${node.title}`;
  // The glyph shows status; the accessible name still says it in words.
  const name = [
    `${node.reference} ${node.title}`,
    status,
    ...(blocking ? ['blocking'] : []),
    ...(isVisible ? [] : ['hidden in this view'])
  ].join(', ');
  return (
    <li
      className={`inspector-relationships__row${blocking ? ' inspector-relationships__row--blocking' : ''}`}
    >
      <button
        type="button"
        className="inspector-relationships__item"
        disabled={!isVisible}
        title={isVisible ? `Select ${node.title}` : `${node.title} is hidden in this view`}
        aria-label={name}
        onClick={() => onSelect(node.id)}
      >
        <span className={`status-dot status-dot--${node.effectiveStatus}`} aria-hidden="true" />
        <span className="inspector-relationships__reference">{node.reference}</span>
        <span className="inspector-relationships__title">{node.title}</span>
        {blocking ? <span className="inspector-relationships__tag">Blocking</span> : null}
      </button>
      <button
        type="button"
        className="inspector-relationships__remove"
        aria-label={removal}
        title={removal}
        onClick={() => void onRemove(entry.relationshipId)}
      >
        ×
      </button>
    </li>
  );
}

function RelationshipSection({
  role,
  entries,
  label,
  removeLabel,
  blockedBy,
  onSelect,
  onRemove
}: {
  role: keyof DirectRelationships;
  entries: DirectlyRelatedWorkNode[];
  label: string;
  removeLabel: string;
  blockedBy: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
  onRemove: (relationshipId: string) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isBlocking = (entry: DirectlyRelatedWorkNode) =>
    blockingRoles.has(role) && blockedBy.has(entry.node.id);
  const { rows, open } = arrangeRows(role, entries, isBlocking);
  const shown = isExpanded ? rows : rows.slice(0, open);
  const folded = rows.slice(shown.length);
  return (
    <div className="inspector-relationships__group">
      <h3 className="inspector__label">
        {label} <span>{entries.length}</span>
      </h3>
      <ul>
        {shown.map((entry) => (
          <RelatedWorkRow
            key={entry.relationshipId}
            entry={entry}
            blocking={isBlocking(entry)}
            removeLabel={removeLabel}
            onSelect={onSelect}
            onRemove={onRemove}
          />
        ))}
      </ul>
      {folded.length > 0 ? (
        <button
          type="button"
          className="inspector-relationships__more"
          onClick={() => setIsExpanded(true)}
        >
          {folded.every(({ node }) => node.effectiveStatus === 'done')
            ? `Show ${folded.length} done`
            : `+${folded.length} more`}
        </button>
      ) : null}
    </div>
  );
}

export function InspectorRelationships({
  relationships,
  blockedBy = [],
  onSelect,
  onRemove
}: {
  relationships: DirectRelationships;
  /** The subject's blockers, so the rows that block it are marked and listed first. */
  blockedBy?: readonly string[];
  onSelect: (nodeId: string) => void;
  onRemove: (relationshipId: string) => Promise<void>;
}) {
  const populated = sections.filter(({ key }) => relationships[key].length > 0);
  if (populated.length === 0) return null;
  const blockers = new Set(blockedBy);
  return (
    <section
      className="inspector__section inspector-relationships"
      aria-label="Direct relationships"
    >
      {populated.map(({ key, label, removeLabel }) => (
        <RelationshipSection
          key={key}
          role={key}
          entries={relationships[key]}
          label={label}
          removeLabel={removeLabel}
          blockedBy={blockers}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
    </section>
  );
}
