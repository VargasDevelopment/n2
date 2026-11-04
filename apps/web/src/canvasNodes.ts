import { isWorkNode, type HandleOrientation } from '@n2/contracts';
import type { CanvasView } from './canvasView.js';
import type { Card } from './groupRegions/shapes.js';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH } from './nodeGeometry.js';
import type { NoteExpansion, NoteFold } from './noteFold.js';
import type { N2NodeActions, StandardCanvasNode } from './components/N2Node.js';
import type { RoadmapCanvasNode } from './components/RoadmapNode.js';
import {
  DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY,
  relationshipNodeHandles,
  type RelationshipHandleGeometry
} from './relationshipHandles.js';
import { ROADMAP_GEOMETRY } from './roadmapGeometry.js';

export type N2CanvasNode = StandardCanvasNode | RoadmapCanvasNode;

export const relationshipHandleGeometryForCanvasItem = (
  item: CanvasView['items'][number]
): RelationshipHandleGeometry =>
  item.renderer === 'roadmap'
    ? {
        depth: ROADMAP_GEOMETRY.handleDepth,
        height: item.height ?? ROADMAP_GEOMETRY.scheduledItemHeight,
        horizontalCenterY: ROADMAP_GEOMETRY.handleTop,
        length: ROADMAP_GEOMETRY.handleLength,
        width: item.width
      }
    : {
        ...DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY,
        height: item.height ?? DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY.height,
        horizontalCenterY: (item.height ?? DEFAULT_RELATIONSHIP_HANDLE_GEOMETRY.height) / 2,
        width: item.width
      };

export const toCanvasNodes = (
  view: CanvasView,
  actions: N2NodeActions,
  handleOrientation: HandleOrientation
): N2CanvasNode[] => {
  const presentationOrientation = view.layout === 'roadmap' ? 'horizontal' : handleOrientation;
  return view.items.map((item) => {
    const common = {
      id: item.node.id,
      position: item.position,
      draggable: item.draggable,
      focusable: item.focusable,
      ...(item.className ? { className: item.className } : {}),
      width: item.width,
      ...(item.height === undefined ? {} : { height: item.height }),
      ...(item.minHeight === undefined ? {} : { style: { minHeight: item.minHeight } })
    };

    return item.renderer === 'roadmap'
      ? {
          ...common,
          type: 'roadmap' as const,
          handles: relationshipNodeHandles(
            'horizontal',
            relationshipHandleGeometryForCanvasItem(item)
          ),
          data: {
            actions,
            node: item.node,
            presentation: item.presentation
          }
        }
      : {
          ...common,
          type: 'n2' as const,
          ...(isWorkNode(item.node)
            ? {
                handles: relationshipNodeHandles(
                  presentationOrientation,
                  relationshipHandleGeometryForCanvasItem(item)
                )
              }
            : {}),
          data: {
            actions,
            handleOrientation: presentationOrientation,
            node: item.node,
            // A card without a fixed height sizes to its content, which is what a Note folds.
            noteFold: item.height === undefined ? 'folded' : 'slot'
          }
        };
  });
};

/**
 * The stacking rule: the card touched most recently is on top. Plain cards sit under selected
 * ones, and expanded Notes over both, the one most recently expanded or pressed highest. This owns
 * stacking outright: React Flow's own selection elevation is turned off in GraphCanvas.
 */
const stackLevel = (selected: boolean, expansionRank?: number): number => {
  if (expansionRank !== undefined) return 2 + expansionRank;
  return selected ? 1 : 0;
};

/**
 * The cards as drawn: React Flow's node state plus the Canvas view state it does not hold, which is
 * selection and expanded Notes. Unchanged nodes keep their identity, so only changed cards
 * re-render.
 */
export const presentCanvasNodes = (
  nodes: readonly N2CanvasNode[],
  selectedNodeIds: ReadonlySet<string>,
  expansion: NoteExpansion
): N2CanvasNode[] =>
  nodes.map((node) => {
    const selected = selectedNodeIds.has(node.id);
    if (node.type === 'n2' && node.data.noteFold === 'folded' && expansion.includes(node.id)) {
      const noteFold: NoteFold = 'expanded';
      const zIndex = stackLevel(selected, expansion.indexOf(node.id));
      return { ...node, selected, zIndex, data: { ...node.data, noteFold } };
    }
    if (selected) return { ...node, selected, zIndex: stackLevel(selected) };
    return node.selected === true ? { ...node, selected } : node;
  });

/**
 * Each card's bounds, as Group regions and Relationship bundles see them. A card without a fixed
 * height, such as a Freeform Note folding or expanding, is as tall as React Flow measured it.
 */
export const canvasCards = (nodes: readonly N2CanvasNode[]): ReadonlyMap<string, Card> =>
  new Map(
    nodes.map((node) => [
      node.id,
      {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? node.measured?.width ?? N2_NODE_WIDTH,
        height: node.height ?? node.measured?.height ?? N2_NODE_HEIGHT
      }
    ])
  );
