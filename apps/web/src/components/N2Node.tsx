import {
  isWorkNode,
  type HandleOrientation,
  type ProjectedNode,
  type ProjectedWorkNode
} from '@n2/contracts';
import { Handle, type Node, type NodeProps, useUpdateNodeInternals } from '@xyflow/react';
import { memo, useLayoutEffect, type Ref } from 'react';
import { useConnectionHighlightNodeRef } from '../connectionHighlightContext.js';
import {
  RELATIONSHIP_OBJECT_HANDLE_ID,
  DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY,
  relationshipHandleCssVariables,
  relationshipHandlePlacement,
  RELATIONSHIP_SUBJECT_HANDLE_ID
} from '../relationshipHandles.js';
import { InlineTitleEditor } from './InlineTitleEditor.js';
import type { NoteFold } from '../noteFold.js';
import { relationshipBlockers } from '../statusPresentation.js';
import { DeleteButton, StatusButton, type N2NodeActions } from './NodeControls.js';
import { NoteCard } from './NoteCard.js';
import './N2Node.css';

export type { N2NodeActions } from './NodeControls.js';

export type N2NodeData = {
  actions: N2NodeActions;
  handleOrientation: HandleOrientation;
  node: ProjectedNode;
  /** How a Note card sizes its content; Work Nodes have a fixed height and ignore it. */
  noteFold: NoteFold;
} & Record<string, unknown>;
export type StandardCanvasNode = Node<N2NodeData, 'n2'>;

/**
 * Lives inside the progress row rather than below it: the card has a fixed height that
 * relationship handles are positioned against, so an extra line would spill past its border.
 */
function BlockedByAnnotation({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="n2-node__blocked"
      title={`Blocked by ${count} ${count === 1 ? 'relationship' : 'relationships'}`}
    >
      Blocked by {count}
    </span>
  );
}

function WorkNodeCard({
  actions,
  handleOrientation,
  networkHighlightRef,
  node,
  selected
}: {
  actions: N2NodeActions;
  handleOrientation: HandleOrientation;
  networkHighlightRef: Ref<HTMLElement>;
  node: ProjectedWorkNode;
  selected: boolean;
}) {
  const progress = Math.round(node.progress * 100);
  const handlePlacement = relationshipHandlePlacement(handleOrientation);
  return (
    <article
      ref={networkHighlightRef}
      className={`n2-node n2-node--${node.kind} ${selected ? 'n2-node--selected' : ''}`}
      data-network-node-id={node.id}
      data-status={node.effectiveStatus}
      style={relationshipHandleCssVariables(DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY)}
    >
      <Handle
        id={RELATIONSHIP_SUBJECT_HANDLE_ID}
        type="source"
        position={handlePlacement.subject.position}
        className={`n2-handle n2-handle--${handlePlacement.subject.side}`}
      />
      <div className="n2-node__eyebrow">
        <span className="n2-node__kind">{node.kind} ·</span>
        <span className="n2-node__reference" title={node.reference}>
          {node.reference}
        </span>
        <span className="n2-node__status-slot">
          <StatusButton actions={actions} node={node} />
        </span>
      </div>
      <InlineTitleEditor
        title={node.title}
        onCommit={async (title) => (await actions.rename(node, title))?.title ?? null}
      />
      <div className="n2-node__progress-row">
        <div
          className="n2-node__track"
          role="progressbar"
          aria-label="Completion"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <span>{progress}%</span>
        <BlockedByAnnotation count={relationshipBlockers(node).length} />
      </div>
      <DeleteButton actions={actions} node={node} selected={selected} />
      <Handle
        id={RELATIONSHIP_OBJECT_HANDLE_ID}
        type="target"
        position={handlePlacement.object.position}
        className={`n2-handle n2-handle--${handlePlacement.object.side}`}
      />
    </article>
  );
}

export const N2Node = memo(function N2Node({ data, selected }: NodeProps<StandardCanvasNode>) {
  const { actions, handleOrientation, node, noteFold } = data;
  const networkHighlightRef = useConnectionHighlightNodeRef(node.id);
  const updateNodeInternals = useUpdateNodeInternals();
  const workNodeId = isWorkNode(node) ? node.id : null;

  useLayoutEffect(() => {
    if (workNodeId) updateNodeInternals(workNodeId);
  }, [handleOrientation, updateNodeInternals, workNodeId]);

  return isWorkNode(node) ? (
    <WorkNodeCard
      actions={actions}
      handleOrientation={handleOrientation}
      networkHighlightRef={networkHighlightRef}
      node={node}
      selected={selected}
    />
  ) : (
    <NoteCard
      actions={actions}
      networkHighlightRef={networkHighlightRef}
      node={node}
      noteFold={noteFold}
      selected={selected}
    />
  );
});
