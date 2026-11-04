import type { ProjectedNode, ProjectedWorkNode } from '@n2/contracts';
import { nodeStatusLabels } from '../statusPresentation.js';

export type N2NodeActions = {
  cycleStatus: (node: ProjectedWorkNode) => void;
  deleteNode: (node: ProjectedNode) => void;
  rename: (node: ProjectedNode, title: string) => Promise<ProjectedNode | null>;
  /** Expands a folded Note on the canvas, or folds it again. Canvas view state only. */
  toggleNoteFold: (noteId: string) => void;
  /** A press on a Note, which raises it if it is expanded. Canvas view state only. */
  touchNote: (noteId: string) => void;
};

export function DeleteButton({
  actions,
  node,
  selected
}: {
  actions: N2NodeActions;
  node: ProjectedNode;
  selected: boolean;
}) {
  return selected ? (
    <button
      type="button"
      className="n2-node__delete nodrag nopan"
      aria-label={`Delete ${node.title}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.deleteNode(node);
      }}
    >
      ×
    </button>
  ) : null;
}

/**
 * When the requested status differs from the effective one, the card shows the requested status as
 * a fixed-size status glyph instead of words: a word truncated to fit read as a stray fragment.
 * The full wording stays in the tooltip, the accessible name, and the Inspector.
 */
export function StatusButton({
  actions,
  className = '',
  node
}: {
  actions: N2NodeActions;
  className?: string;
  node: ProjectedWorkNode;
}) {
  const overridden = node.requestedStatus !== node.effectiveStatus;
  return (
    <button
      type="button"
      className={`n2-node__status nodrag nopan ${className}`}
      data-status={node.effectiveStatus}
      onClick={(event) => {
        event.stopPropagation();
        actions.cycleStatus(node);
      }}
      aria-label={`Effective status: ${nodeStatusLabels[node.effectiveStatus]}. Requested status: ${nodeStatusLabels[node.requestedStatus]}. Click to cycle the requested status.`}
      title={`Requested: ${nodeStatusLabels[node.requestedStatus]}. Click to cycle.`}
    >
      <span className={`status-dot status-dot--${node.effectiveStatus}`} aria-hidden="true" />
      {nodeStatusLabels[node.effectiveStatus]}
      {overridden ? (
        <small className="n2-node__requested" aria-hidden="true">
          <span className={`status-dot status-dot--${node.requestedStatus}`} />
        </small>
      ) : null}
    </button>
  );
}
