import { relationshipEndpointIds } from '@n2/contracts';
import { MarkerType } from '@xyflow/react';
import type { CanvasGraph } from './canvasGraph.js';
import type { N2CanvasEdge } from './components/N2Edge.js';
import { relationshipLanes } from './relationshipEdgeLayout.js';
import { relationshipAriaLabel, relationshipColor } from './relationshipPresentation.js';
import {
  RELATIONSHIP_OBJECT_HANDLE_ID,
  RELATIONSHIP_SUBJECT_HANDLE_ID
} from './relationshipHandles.js';

/** How the canvas around the edges draws relationships (ADR 0016). */
export type EdgePresentation = {
  /** Group regions draw Member of, so its lines rest hidden. Freeform only. */
  groupRegions: boolean;
  /** Relationships the selection reveals: drawn whole, with labels. */
  focusedRelationshipIds: ReadonlySet<string>;
  /** Relationships a counted bundle stands for when the canvas is zoomed out. */
  bundledRelationshipIds: ReadonlySet<string>;
};

const PLAIN_PRESENTATION: EdgePresentation = {
  groupRegions: false,
  focusedRelationshipIds: new Set(),
  bundledRelationshipIds: new Set()
};

export const toCanvasEdges = (
  graph: CanvasGraph,
  selectedRelationshipIds: ReadonlySet<string>,
  presentation: EdgePresentation = PLAIN_PRESENTATION
): N2CanvasEdge[] => {
  const titleByNodeId = new Map(graph.nodes.map((node) => [node.id, node.title]));
  const lanes = relationshipLanes(graph.relationships);
  return graph.relationships.map((relationship) => {
    const { objectId, subjectId } = relationshipEndpointIds(relationship);
    return {
      id: relationship.id,
      source: subjectId,
      target: objectId,
      sourceHandle: RELATIONSHIP_SUBJECT_HANDLE_ID,
      targetHandle: RELATIONSHIP_OBJECT_HANDLE_ID,
      type: 'n2',
      data: {
        relationship,
        lane: lanes.get(relationship.id) ?? 0,
        groupRegions: presentation.groupRegions,
        focused: presentation.focusedRelationshipIds.has(relationship.id),
        bundled: presentation.bundledRelationshipIds.has(relationship.id)
      },
      selected: selectedRelationshipIds.has(relationship.id),
      ariaLabel: relationshipAriaLabel(relationship, titleByNodeId),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: relationshipColor(relationship)
      }
    };
  });
};
