import type { ProjectedRelationship } from '@n2/contracts';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type Edge,
  type EdgeProps
} from '@xyflow/react';
import { useConnectionHighlightRelationshipRef } from '../connectionHighlightContext.js';
import { parallelRelationshipPath } from '../relationshipEdgeLayout.js';
import { relationshipLabel } from '../relationshipPresentation.js';
import { labelAtRest, restingForm, STUB_PATH_LENGTH, stubDashArray } from '../relationshipRest.js';
import './N2Edge.css';

export type N2EdgeData = {
  lane: number;
  relationship: ProjectedRelationship;
  /** Group regions draw Member of on this canvas, so its line rests hidden. */
  groupRegions: boolean;
  /** The selection reveals this relationship: drawn whole, with its label. */
  focused: boolean;
  /** Zoomed out, a counted bundle stands for this relationship. */
  bundled: boolean;
} & Record<string, unknown>;
export type N2CanvasEdge = Edge<N2EdgeData, 'n2'>;

/**
 * One relationship. How it rests (whole, as stubs, or hidden) is decided here and written as data
 * attributes; N2Edge.css reveals it from the hover highlight and selection focus without a render.
 */
export function N2Edge({
  id,
  data,
  interactionWidth = 20,
  markerEnd,
  selected,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition
}: EdgeProps<N2CanvasEdge>) {
  const edgeNetworkHighlightRef = useConnectionHighlightRelationshipRef(id);
  const labelNetworkHighlightRef = useConnectionHighlightRelationshipRef(id);

  if (!data) return null;

  const [edgePath, labelX, labelY] =
    parallelRelationshipPath({
      lane: data.lane,
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition
    }) ??
    (data.relationship.kind === 'member_of'
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 18
        })
      : getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition
        }));
  const length = Math.hypot(targetX - sourceX, targetY - sourceY);
  const form = restingForm(data.relationship, { groupRegions: data.groupRegions, length });
  const revealed = selected === true || data.focused;
  // The hit path carries the same dashes, so the empty stretch of a stub does not catch clicks
  // meant for the canvas beneath it.
  const stub =
    form === 'stub' ? { pathLength: STUB_PATH_LENGTH, strokeDasharray: stubDashArray(length) } : {};
  const className = [
    'n2-edge',
    `n2-edge--${data.relationship.kind}`,
    data.relationship.isBlocking ? 'n2-edge--blocking' : '',
    selected ? 'n2-edge--selected' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const labelClassName = [
    'n2-edge__label',
    `n2-edge__label--${data.relationship.kind}`,
    data.relationship.isBlocking ? 'n2-edge__label--blocking' : '',
    selected ? 'n2-edge__label--selected' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <g
        ref={edgeNetworkHighlightRef}
        data-network-relationship-id={id}
        data-relationship-rest={form}
        data-relationship-focus={revealed || undefined}
        data-relationship-bundled={data.bundled || undefined}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          className={className}
          interactionWidth={0}
          {...(markerEnd ? { markerEnd } : {})}
          {...stub}
        />
        <path
          className="react-flow__edge-interaction"
          d={edgePath}
          fill="none"
          strokeOpacity={0}
          strokeWidth={interactionWidth}
          {...stub}
        />
      </g>
      <EdgeLabelRenderer>
        <span
          ref={labelNetworkHighlightRef}
          className={labelClassName}
          data-network-relationship-id={id}
          data-label-at-rest={labelAtRest(data.relationship) || undefined}
          data-relationship-focus={revealed || undefined}
          data-relationship-bundled={data.bundled || undefined}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
          }}
        >
          {relationshipLabel(data.relationship)}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
