import { isWorkNode, NODE_STATUSES, type NodeStatus, type ProjectedWorkNode } from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH, N2_NOTE_WIDTH } from './nodeGeometry.js';
import type { ResolvedCanvasItem } from './resolvedCanvasItem.js';
import type { SwimlaneModel } from './swimlaneModel.js';
import {
  byAuthoritativePosition,
  requireResolvedItem,
  structuredNoteItem,
  structuredWorkItem
} from './structuredCanvasItems.js';
import {
  SWIMLANE_ITEM_GAP,
  SWIMLANE_LABEL_WIDTH,
  SWIMLANE_PADDING,
  SWIMLANE_REFERENCE_HEIGHT,
  type SwimlaneBand,
  type SwimlaneReference
} from './swimlaneLayout.js';

export const KANBAN_COLUMN_WIDTH = 270;
export const KANBAN_COLUMN_GAP = 24;
export const KANBAN_COLUMN_PADDING = 20;
export const KANBAN_NOTES_COLUMN_WIDTH = N2_NOTE_WIDTH + KANBAN_COLUMN_PADDING * 2;
export const KANBAN_HEADER_HEIGHT = 72;
export const KANBAN_CARD_GAP = 24;
export const KANBAN_MIN_COLUMN_HEIGHT = 580;
export const KANBAN_NOTE_HEIGHT = 360;

export type KanbanColumn = {
  id: NodeStatus | 'notes';
  x: number;
  width: number;
  count: number;
};

export type KanbanBoard = {
  columns: readonly KanbanColumn[];
  width: number;
  height: number;
  lanes: readonly SwimlaneBand[];
  references: readonly SwimlaneReference[];
};

export type KanbanResolution = {
  items: readonly ResolvedCanvasItem[];
  board: KanbanBoard;
};

const columnX = (index: number, offset = 0): number =>
  offset + index * (KANBAN_COLUMN_WIDTH + KANBAN_COLUMN_GAP);

const columns = (graph: CanvasGraph, notesCount: number, offset = 0): KanbanColumn[] => [
  ...NODE_STATUSES.map((status, index) => ({
    id: status,
    x: columnX(index, offset),
    width: KANBAN_COLUMN_WIDTH,
    count: graph.nodes.filter((node) => isWorkNode(node) && node.effectiveStatus === status).length
  })),
  {
    id: 'notes' as const,
    x: columnX(NODE_STATUSES.length, offset),
    width: KANBAN_NOTES_COLUMN_WIDTH,
    count: notesCount
  }
];

const resolvePlainKanban = (graph: CanvasGraph): KanbanResolution => {
  const workByStatus = new Map(NODE_STATUSES.map((status) => [status, [] as ProjectedWorkNode[]]));
  const notes = graph.nodes.filter((node) => !isWorkNode(node)).sort(byAuthoritativePosition);
  for (const node of graph.nodes) {
    if (isWorkNode(node)) workByStatus.get(node.effectiveStatus)?.push(node);
  }
  for (const nodes of workByStatus.values()) nodes.sort(byAuthoritativePosition);

  const resolvedByNodeId = new Map<string, ResolvedCanvasItem>();
  let boardHeight = KANBAN_MIN_COLUMN_HEIGHT;
  NODE_STATUSES.forEach((status, columnIndex) => {
    const nodes = workByStatus.get(status) ?? [];
    nodes.forEach((node, rowIndex) => {
      resolvedByNodeId.set(
        node.id,
        structuredWorkItem(
          node,
          {
            x: columnX(columnIndex) + (KANBAN_COLUMN_WIDTH - N2_NODE_WIDTH) / 2,
            y: KANBAN_HEADER_HEIGHT + rowIndex * (N2_NODE_HEIGHT + KANBAN_CARD_GAP)
          },
          true
        )
      );
    });
    boardHeight = Math.max(
      boardHeight,
      KANBAN_HEADER_HEIGHT +
        nodes.length * (N2_NODE_HEIGHT + KANBAN_CARD_GAP) +
        KANBAN_COLUMN_PADDING
    );
  });

  let noteY = KANBAN_HEADER_HEIGHT;
  const notesX = columnX(NODE_STATUSES.length) + (KANBAN_NOTES_COLUMN_WIDTH - N2_NOTE_WIDTH) / 2;
  for (const note of notes) {
    resolvedByNodeId.set(
      note.id,
      structuredNoteItem(note, { x: notesX, y: noteY }, KANBAN_NOTE_HEIGHT)
    );
    noteY += KANBAN_NOTE_HEIGHT + KANBAN_CARD_GAP;
  }
  boardHeight = Math.max(boardHeight, noteY + KANBAN_COLUMN_PADDING);

  return {
    items: graph.nodes.map((node) => requireResolvedItem(node, resolvedByNodeId, 'Kanban')),
    board: {
      columns: columns(graph, notes.length),
      width: columnX(NODE_STATUSES.length) + KANBAN_NOTES_COLUMN_WIDTH,
      height: boardHeight,
      lanes: [],
      references: []
    }
  };
};

const resolveSwimlaneKanban = (graph: CanvasGraph, model: SwimlaneModel): KanbanResolution => {
  const columnOffset = SWIMLANE_LABEL_WIDTH;
  const workLanes = model.lanes.filter(({ kind }) => kind !== 'notes');
  const notes = graph.nodes.filter((node) => !isWorkNode(node)).sort(byAuthoritativePosition);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const resolvedByNodeId = new Map<string, ResolvedCanvasItem>();
  const lanes: SwimlaneBand[] = [];
  const references: SwimlaneReference[] = [];
  let laneY = KANBAN_HEADER_HEIGHT;

  for (const lane of workLanes) {
    const primaryWork = lane.primaryNodeIds
      .map((id) => nodeById.get(id))
      .filter((node) => node !== undefined && isWorkNode(node));
    const referenceWork = lane.referenceNodeIds
      .map((id) => nodeById.get(id))
      .filter((node) => node !== undefined && isWorkNode(node));
    const primariesByStatus = new Map(
      NODE_STATUSES.map((status) => [
        status,
        primaryWork.filter((node) => node.effectiveStatus === status)
      ])
    );
    const referencesByStatus = new Map(
      NODE_STATUSES.map((status) => [
        status,
        referenceWork.filter((node) => node.effectiveStatus === status)
      ])
    );
    const laneContentHeight = Math.max(
      56,
      ...NODE_STATUSES.map((status) => {
        const primaryCount = primariesByStatus.get(status)?.length ?? 0;
        const referenceCount = referencesByStatus.get(status)?.length ?? 0;
        return (
          primaryCount * N2_NODE_HEIGHT +
          Math.max(0, primaryCount - 1) * KANBAN_CARD_GAP +
          (primaryCount && referenceCount ? SWIMLANE_ITEM_GAP : 0) +
          referenceCount * SWIMLANE_REFERENCE_HEIGHT +
          Math.max(0, referenceCount - 1) * 8
        );
      })
    );
    const laneHeight = laneContentHeight + SWIMLANE_PADDING * 2;

    NODE_STATUSES.forEach((status, columnIndex) => {
      const primaryNodes = primariesByStatus.get(status) ?? [];
      const referenceNodes = referencesByStatus.get(status) ?? [];
      primaryNodes.forEach((node, index) => {
        resolvedByNodeId.set(
          node.id,
          structuredWorkItem(
            node,
            {
              x: columnX(columnIndex, columnOffset) + (KANBAN_COLUMN_WIDTH - N2_NODE_WIDTH) / 2,
              y: laneY + SWIMLANE_PADDING + index * (N2_NODE_HEIGHT + KANBAN_CARD_GAP)
            },
            true
          )
        );
      });
      const referenceY =
        laneY +
        SWIMLANE_PADDING +
        primaryNodes.length * N2_NODE_HEIGHT +
        Math.max(0, primaryNodes.length - 1) * KANBAN_CARD_GAP +
        (primaryNodes.length && referenceNodes.length ? SWIMLANE_ITEM_GAP : 0);
      referenceNodes.forEach((node, index) => {
        references.push({
          presentation: 'card',
          laneId: lane.id,
          nodeId: node.id,
          reference: node.reference,
          title: node.title,
          x: columnX(columnIndex, columnOffset) + KANBAN_COLUMN_PADDING,
          y: referenceY + index * (SWIMLANE_REFERENCE_HEIGHT + 8),
          width: KANBAN_COLUMN_WIDTH - KANBAN_COLUMN_PADDING * 2,
          height: SWIMLANE_REFERENCE_HEIGHT
        });
      });
    });
    lanes.push({ ...lane, y: laneY, height: laneHeight });
    laneY += laneHeight;
  }

  const notesX =
    columnX(NODE_STATUSES.length, columnOffset) + (KANBAN_NOTES_COLUMN_WIDTH - N2_NOTE_WIDTH) / 2;
  notes.forEach((note, index) => {
    resolvedByNodeId.set(
      note.id,
      structuredNoteItem(
        note,
        { x: notesX, y: KANBAN_HEADER_HEIGHT + index * (KANBAN_NOTE_HEIGHT + KANBAN_CARD_GAP) },
        KANBAN_NOTE_HEIGHT
      )
    );
  });
  const notesHeight =
    KANBAN_HEADER_HEIGHT +
    notes.length * (KANBAN_NOTE_HEIGHT + KANBAN_CARD_GAP) +
    KANBAN_COLUMN_PADDING;

  return {
    items: graph.nodes.map((node) =>
      requireResolvedItem(node, resolvedByNodeId, 'Kanban + Swimlane')
    ),
    board: {
      columns: columns(graph, notes.length, columnOffset),
      width: columnX(NODE_STATUSES.length, columnOffset) + KANBAN_NOTES_COLUMN_WIDTH,
      height: Math.max(KANBAN_MIN_COLUMN_HEIGHT, laneY, notesHeight),
      lanes,
      references
    }
  };
};

export const resolveKanban = (
  graph: CanvasGraph,
  swimlaneModel: SwimlaneModel | null = null
): KanbanResolution =>
  swimlaneModel ? resolveSwimlaneKanban(graph, swimlaneModel) : resolvePlainKanban(graph);

export const kanbanStatusAtX = (x: number, board: KanbanBoard): NodeStatus | null => {
  const column = board.columns.find(
    (candidate) =>
      candidate.id !== 'notes' && x >= candidate.x && x <= candidate.x + candidate.width
  );
  return column?.id === 'notes' || column === undefined ? null : column.id;
};
