import { isWorkNode, type ProjectedNode } from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH, N2_NOTE_WIDTH } from './nodeGeometry.js';
import type { ResolvedCanvasItem } from './resolvedCanvasItem.js';
import {
  requireResolvedItem,
  structuredNoteItem,
  structuredWorkItem
} from './structuredCanvasItems.js';
import type { SwimlaneModel } from './swimlaneModel.js';
import {
  SWIMLANE_ITEM_GAP,
  SWIMLANE_LABEL_WIDTH,
  SWIMLANE_PADDING,
  SWIMLANE_REFERENCE_HEIGHT,
  type SwimlaneBand,
  type SwimlaneReference
} from './swimlaneLayout.js';

export const SWIMLANE_BOARD_WIDTH = 1_160;
export const SWIMLANE_HEADER_HEIGHT = 64;
export const SWIMLANE_NOTE_HEIGHT = 300;

export type SwimlaneBoard = {
  width: number;
  height: number;
  lanes: readonly SwimlaneBand[];
  references: readonly SwimlaneReference[];
};

export type SwimlaneResolution = {
  items: readonly ResolvedCanvasItem[];
  board: SwimlaneBoard;
};

export const resolveSwimlane = (graph: CanvasGraph, model: SwimlaneModel): SwimlaneResolution => {
  const contentX = SWIMLANE_LABEL_WIDTH + SWIMLANE_PADDING;
  const contentWidth = SWIMLANE_BOARD_WIDTH - contentX - SWIMLANE_PADDING;
  const workColumns = Math.max(
    1,
    Math.floor((contentWidth + SWIMLANE_ITEM_GAP) / (N2_NODE_WIDTH + SWIMLANE_ITEM_GAP))
  );
  const noteColumns = Math.max(
    1,
    Math.floor((contentWidth + SWIMLANE_ITEM_GAP) / (N2_NOTE_WIDTH + SWIMLANE_ITEM_GAP))
  );
  const resolvedByNodeId = new Map<string, ResolvedCanvasItem>();
  const references: SwimlaneReference[] = [];
  const lanes: SwimlaneBand[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const presentNodes = (ids: readonly string[]): ProjectedNode[] =>
    ids.map((id) => nodeById.get(id)).filter((node) => node !== undefined);
  let laneY = 0;

  for (const lane of model.lanes) {
    const primaryNodes = presentNodes(lane.primaryNodeIds);
    const referenceNodes = presentNodes(lane.referenceNodeIds);
    const isNotes = lane.kind === 'notes';
    const itemWidth = isNotes ? N2_NOTE_WIDTH : N2_NODE_WIDTH;
    const itemHeight = isNotes ? SWIMLANE_NOTE_HEIGHT : N2_NODE_HEIGHT;
    const columns = isNotes ? noteColumns : workColumns;
    const itemRows = primaryNodes.length === 0 ? 0 : Math.ceil(primaryNodes.length / columns);
    const referenceRows =
      referenceNodes.length === 0 ? 0 : Math.ceil(referenceNodes.length / columns);
    const primaryHeight = itemRows * itemHeight + Math.max(0, itemRows - 1) * SWIMLANE_ITEM_GAP;
    const referenceHeight =
      referenceRows * SWIMLANE_REFERENCE_HEIGHT +
      Math.max(0, referenceRows - 1) * SWIMLANE_ITEM_GAP;
    const laneContentHeight = Math.max(
      56,
      primaryHeight + (primaryHeight && referenceHeight ? SWIMLANE_ITEM_GAP : 0) + referenceHeight
    );
    const laneHeight = laneContentHeight + SWIMLANE_PADDING * 2;

    primaryNodes.forEach((node, index) => {
      const position = {
        x: contentX + (index % columns) * (itemWidth + SWIMLANE_ITEM_GAP),
        y: laneY + SWIMLANE_PADDING + Math.floor(index / columns) * (itemHeight + SWIMLANE_ITEM_GAP)
      };
      resolvedByNodeId.set(
        node.id,
        isWorkNode(node)
          ? structuredWorkItem(node, position)
          : structuredNoteItem(node, position, SWIMLANE_NOTE_HEIGHT)
      );
    });
    referenceNodes.forEach((node, index) => {
      references.push({
        presentation: 'card',
        laneId: lane.id,
        nodeId: node.id,
        reference: node.reference,
        title: node.title,
        x: contentX + (index % columns) * (N2_NODE_WIDTH + SWIMLANE_ITEM_GAP),
        y:
          laneY +
          SWIMLANE_PADDING +
          primaryHeight +
          (primaryHeight ? SWIMLANE_ITEM_GAP : 0) +
          Math.floor(index / columns) * (SWIMLANE_REFERENCE_HEIGHT + SWIMLANE_ITEM_GAP),
        width: N2_NODE_WIDTH,
        height: SWIMLANE_REFERENCE_HEIGHT
      });
    });
    lanes.push({ ...lane, y: laneY, height: laneHeight });
    laneY += laneHeight;
  }

  return {
    items: graph.nodes.map((node) => requireResolvedItem(node, resolvedByNodeId, 'Swimlane')),
    board: { width: SWIMLANE_BOARD_WIDTH, height: laneY, lanes, references }
  };
};
