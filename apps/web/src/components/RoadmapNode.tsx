import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { useConnectionHighlightNodeRef } from '../connectionHighlightContext.js';
import type {
  RoadmapResolvedCanvasItem,
  ScheduledProjectedWorkNode
} from '../resolvedCanvasItem.js';
import {
  RELATIONSHIP_OBJECT_HANDLE_ID,
  relationshipHandleCssVariables,
  RELATIONSHIP_SUBJECT_HANDLE_ID
} from '../relationshipHandles.js';
import { ROADMAP_GEOMETRY } from '../roadmapGeometry.js';
import { InlineTitleEditor } from './InlineTitleEditor.js';
import { DeleteButton, StatusButton, type N2NodeActions } from './NodeControls.js';
import './RoadmapNode.css';

export type RoadmapNodeData = {
  actions: N2NodeActions;
  node: ScheduledProjectedWorkNode;
  presentation: RoadmapResolvedCanvasItem['presentation'];
} & Record<string, unknown>;

export type RoadmapCanvasNode = Node<RoadmapNodeData, 'roadmap'>;

const roadmapGeometryStyle = {
  ...relationshipHandleCssVariables({
    depth: ROADMAP_GEOMETRY.handleDepth,
    horizontalCenterY: ROADMAP_GEOMETRY.handleTop,
    length: ROADMAP_GEOMETRY.handleLength
  }),
  '--roadmap-caption-width': `${ROADMAP_GEOMETRY.captionWidth}px`,
  '--roadmap-placement-top': `${ROADMAP_GEOMETRY.placementTop}px`,
  '--roadmap-milestone-top': `${ROADMAP_GEOMETRY.milestoneTop}px`,
  '--roadmap-milestone-size': `${ROADMAP_GEOMETRY.milestoneSize}px`,
  '--roadmap-minimum-hit-width': `${ROADMAP_GEOMETRY.minimumHitWidth}px`,
  '--roadmap-hit-height': `${ROADMAP_GEOMETRY.hitHeight}px`
} as CSSProperties;

export const RoadmapNode = memo(function RoadmapNode({
  data,
  selected
}: NodeProps<RoadmapCanvasNode>) {
  const { actions, node, presentation } = data;
  const networkHighlightRef = useConnectionHighlightNodeRef(node.id);
  const progress = Math.round(node.progress * 100);

  return (
    <article
      ref={networkHighlightRef}
      className={`n2-roadmap-node ${selected ? 'n2-roadmap-node--selected' : ''}`}
      data-network-node-id={node.id}
      data-node-kind={node.kind}
      data-placement-kind={node.planningPlacement.kind}
      data-clipped-start={presentation.clippedAtStart || undefined}
      data-clipped-end={presentation.clippedAtEnd || undefined}
      data-status={node.effectiveStatus}
      style={roadmapGeometryStyle}
    >
      <Handle
        id={RELATIONSHIP_SUBJECT_HANDLE_ID}
        type="source"
        position={Position.Left}
        className="n2-handle n2-handle--left n2-roadmap-node__handle"
      />
      <div
        className="n2-roadmap-node__caption"
        data-caption-alignment={presentation.captionAlignment}
      >
        <InlineTitleEditor
          title={node.title}
          onCommit={async (title) => (await actions.rename(node, title))?.title ?? null}
        />
        <div className="n2-roadmap-node__meta">
          <span className="n2-roadmap-node__kind">
            {node.kind} · {node.reference}
          </span>
          <span className="n2-roadmap-node__date">{presentation.placementLabel}</span>
          <StatusButton actions={actions} className="n2-roadmap-node__status" node={node} />
        </div>
      </div>
      <DeleteButton actions={actions} node={node} selected={selected} />
      <div
        className="n2-roadmap-node__placement"
        data-placement-kind={node.planningPlacement.kind}
        role="progressbar"
        aria-label="Completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <Handle
        id={RELATIONSHIP_OBJECT_HANDLE_ID}
        type="target"
        position={Position.Right}
        className="n2-handle n2-handle--right n2-roadmap-node__handle"
      />
    </article>
  );
});
