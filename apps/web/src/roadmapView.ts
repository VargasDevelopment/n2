import {
  isWorkNode,
  type PlanningDate,
  type PlanningPlacement,
  type Position,
  type ProjectedNode,
  type ProjectedWorkNode
} from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH, N2_NOTE_WIDTH } from './nodeGeometry.js';
import type {
  ResolvedCanvasItem,
  RoadmapResolvedCanvasItem,
  ScheduledProjectedWorkNode
} from './resolvedCanvasItem.js';
import { ROADMAP_GEOMETRY } from './roadmapGeometry.js';
import {
  createRoadmapRange,
  daysBetween,
  intersectPlanningPlacement,
  placementEnd,
  placementStart,
  planningDateOrdinal,
  shiftPlanningDate,
  type RoadmapRange
} from './roadmapRange.js';
import type { SwimlaneModel } from './swimlaneModel.js';
import { resolveRoadmapSwimlaneLayout } from './roadmapSwimlaneLayout.js';
import {
  byAuthoritativePosition,
  structuredNoteItem,
  structuredWorkItem
} from './structuredCanvasItems.js';
import {
  SWIMLANE_LABEL_WIDTH,
  SWIMLANE_PADDING,
  type SwimlaneBand,
  type SwimlaneReference
} from './swimlaneLayout.js';
const placementDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric'
});
export type RoadmapTick = {
  date: PlanningDate;
  label: string;
  x: number;
};

export type RoadmapAxis = {
  startDate: PlanningDate;
  endDate: PlanningDate;
  x: number;
  width: number;
  dayWidth: number;
  ticks: readonly RoadmapTick[];
};

export type RoadmapRegion = {
  id: 'scheduled' | 'unscheduled' | 'notes';
  count: number;
  y: number;
  height: number;
};

export type RoadmapBoard = {
  width: number;
  height: number;
  axis: RoadmapAxis | null;
  regions: readonly RoadmapRegion[];
  lanes: readonly SwimlaneBand[];
  references: readonly SwimlaneReference[];
};

export type RoadmapResolution = {
  items: readonly ResolvedCanvasItem[];
  board: RoadmapBoard;
};

type RoadmapSchedule = RoadmapRange & {
  nodes: readonly ScheduledProjectedWorkNode[];
  startDate: PlanningDate;
  endDate: PlanningDate;
  dayWidth: number;
  timelineWidth: number;
};

const formatPlanningDate = (date: PlanningDate, includeYear = false): string => {
  const monthAndDay = placementDateFormatter.format(new Date(planningDateOrdinal(date)));
  return includeYear ? `${monthAndDay}, ${date.slice(0, 4)}` : monthAndDay;
};

// A Milestone names itself, so its one date is not read from the diamond alone or taken for a due
// date. A Planning Window's range already reads as a span.
const placementLabel = (placement: PlanningPlacement): string =>
  placement.kind === 'milestone'
    ? `Milestone ${formatPlanningDate(placement.date, true)}`
    : `${formatPlanningDate(
        placement.startDate,
        placement.startDate.slice(0, 4) !== placement.endDate.slice(0, 4)
      )} – ${formatPlanningDate(placement.endDate, true)}`;

const byPlanningPlacement = (
  left: ScheduledProjectedWorkNode,
  right: ScheduledProjectedWorkNode
): number => {
  const leftPlacement = left.planningPlacement;
  const rightPlacement = right.planningPlacement;
  return (
    placementStart(leftPlacement).localeCompare(placementStart(rightPlacement)) ||
    placementEnd(leftPlacement).localeCompare(placementEnd(rightPlacement)) ||
    byAuthoritativePosition(left, right)
  );
};

const isScheduledWorkNode = (node: ProjectedNode): node is ScheduledProjectedWorkNode =>
  isWorkNode(node) && node.planningPlacement !== undefined;

const roadmapWorkItem = ({
  boardWidth,
  node,
  placementLabel,
  position,
  width,
  clippedAtStart,
  clippedAtEnd
}: {
  boardWidth: number;
  node: ScheduledProjectedWorkNode;
  placementLabel: string;
  position: Position;
  width: number;
  clippedAtStart: boolean;
  clippedAtEnd: boolean;
}): RoadmapResolvedCanvasItem => ({
  renderer: 'roadmap',
  node,
  position,
  width,
  height: ROADMAP_GEOMETRY.scheduledItemHeight,
  draggable: false,
  focusable: false,
  className: 'n2-canvas-roadmap-placement',
  presentation: {
    placementLabel,
    clippedAtStart,
    clippedAtEnd,
    captionAlignment:
      position.x + ROADMAP_GEOMETRY.captionWidth > boardWidth - ROADMAP_GEOMETRY.sidePadding
        ? 'end'
        : 'start'
  }
});

const gridLayout = ({
  boardWidth,
  itemHeight,
  itemWidth,
  nodes,
  regionY
}: {
  boardWidth: number;
  itemHeight: number;
  itemWidth: number;
  nodes: readonly ProjectedNode[];
  regionY: number;
}): { height: number; items: readonly ResolvedCanvasItem[] } => {
  const columns = Math.max(
    1,
    Math.floor(
      (boardWidth - ROADMAP_GEOMETRY.sidePadding * 2 + ROADMAP_GEOMETRY.gridGap) /
        (itemWidth + ROADMAP_GEOMETRY.gridGap)
    )
  );
  const usedColumns = Math.min(columns, Math.max(1, nodes.length));
  const contentWidth = usedColumns * itemWidth + (usedColumns - 1) * ROADMAP_GEOMETRY.gridGap;
  const originX = (boardWidth - contentWidth) / 2;
  const items = nodes.map((node, index) => {
    const position = {
      x: originX + (index % columns) * (itemWidth + ROADMAP_GEOMETRY.gridGap),
      y:
        regionY +
        ROADMAP_GEOMETRY.sectionHeaderHeight +
        Math.floor(index / columns) * (itemHeight + ROADMAP_GEOMETRY.gridGap)
    };
    return isWorkNode(node)
      ? structuredWorkItem(node, position)
      : structuredNoteItem(node, position, ROADMAP_GEOMETRY.noteHeight);
  });
  const rows = nodes.length === 0 ? 0 : Math.ceil(nodes.length / columns);
  return {
    height:
      ROADMAP_GEOMETRY.sectionHeaderHeight +
      Math.max(52, rows * itemHeight + Math.max(0, rows - 1) * ROADMAP_GEOMETRY.gridGap) +
      ROADMAP_GEOMETRY.sidePadding,
    items
  };
};

const dayWidthFor = (dayCount: number): number => {
  const naturalWidth =
    dayCount <= 21 ? 64 : dayCount <= 62 ? 40 : dayCount <= 124 ? 22 : dayCount <= 370 ? 10 : 6;
  return Math.min(naturalWidth, ROADMAP_GEOMETRY.maxTimelineWidth / dayCount);
};

const tickDates = (
  startDate: PlanningDate,
  endDate: PlanningDate,
  dayWidth: number
): PlanningDate[] => {
  const dayCount = daysBetween(startDate, endDate) + 1;
  const stepDays = dayWidth >= 40 ? 1 : dayWidth >= 16 ? 7 : Math.max(28, Math.ceil(90 / dayWidth));
  const dates = Array.from({ length: Math.ceil(dayCount / stepDays) }, (_, index) =>
    shiftPlanningDate(startDate, index * stepDays)
  );
  const finalTick = dates.at(-1);
  if (
    finalTick !== endDate &&
    finalTick !== undefined &&
    daysBetween(finalTick, endDate) * dayWidth >= ROADMAP_GEOMETRY.minTickSpacing
  ) {
    dates.push(endDate);
  }
  return dates;
};

const resolveSchedule = (
  first: ScheduledProjectedWorkNode | undefined,
  remaining: readonly ScheduledProjectedWorkNode[],
  roadmapRange: RoadmapRange | null
): RoadmapSchedule => {
  if (roadmapRange) {
    const dayCount = daysBetween(roadmapRange.startDate, roadmapRange.endDate) + 1;
    const dayWidth = dayWidthFor(dayCount);
    return {
      nodes: first ? [first, ...remaining] : [],
      ...roadmapRange,
      dayWidth,
      timelineWidth: dayCount * dayWidth
    };
  }
  if (!first) throw new Error('An automatic Roadmap schedule requires scheduled work.');
  const latestPlacement = remaining.reduce(
    (latest, node) =>
      placementEnd(node.planningPlacement) > placementEnd(latest) ? node.planningPlacement : latest,
    first.planningPlacement
  );
  const startDate = shiftPlanningDate(
    placementStart(first.planningPlacement),
    -ROADMAP_GEOMETRY.rangePaddingDays
  );
  const endDate = shiftPlanningDate(
    placementEnd(latestPlacement),
    ROADMAP_GEOMETRY.rangePaddingDays
  );
  const dayCount = daysBetween(startDate, endDate) + 1;
  const dayWidth = dayWidthFor(dayCount);
  const range = createRoadmapRange(startDate, endDate);
  return {
    nodes: [first, ...remaining],
    ...range,
    dayWidth,
    timelineWidth: dayCount * dayWidth
  };
};

export const resolveRoadmap = (
  graph: CanvasGraph,
  roadmapRange: RoadmapRange | null = null,
  swimlaneModel: SwimlaneModel | null = null
): RoadmapResolution => {
  const scheduled = graph.nodes.filter(isScheduledWorkNode).sort(byPlanningPlacement);
  const unscheduled = graph.nodes
    .filter((node): node is ProjectedWorkNode => isWorkNode(node) && !node.planningPlacement)
    .sort(byAuthoritativePosition);
  const notes = graph.nodes.filter((node) => !isWorkNode(node)).sort(byAuthoritativePosition);

  const firstScheduled = scheduled[0];
  const schedule =
    roadmapRange || firstScheduled
      ? resolveSchedule(firstScheduled, scheduled.slice(1), roadmapRange)
      : null;
  const timelineWidth = schedule?.timelineWidth ?? 0;
  const laneLabelGutter = swimlaneModel ? SWIMLANE_LABEL_WIDTH + SWIMLANE_PADDING : 0;
  const boardWidth = Math.max(
    ROADMAP_GEOMETRY.minWidth,
    laneLabelGutter + timelineWidth + N2_NODE_WIDTH + ROADMAP_GEOMETRY.sidePadding * 2
  );
  const axisX = laneLabelGutter + (boardWidth - laneLabelGutter - timelineWidth) / 2;

  const resolvedByNodeId = new Map<string, ResolvedCanvasItem>();
  const horizontalGeometry = new Map<string, { x: number; width: number }>();
  schedule?.nodes.forEach((node) => {
    const placement = node.planningPlacement;
    const visiblePlacement = intersectPlanningPlacement(placement, schedule);
    const startOffset = daysBetween(schedule.startDate, visiblePlacement.startDate);
    const endOffset = daysBetween(schedule.startDate, visiblePlacement.endDate);
    const x = axisX + startOffset * schedule.dayWidth;
    const temporalWidth =
      placement.kind === 'milestone' ? 0 : (endOffset - startOffset + 1) * schedule.dayWidth;
    const anchorX =
      placement.kind === 'milestone' ? x + schedule.dayWidth / 2 : x + temporalWidth / 2;
    const renderedWidth =
      placement.kind === 'milestone' ? ROADMAP_GEOMETRY.milestoneWidth : temporalWidth;
    const renderedX = anchorX - renderedWidth / 2;
    horizontalGeometry.set(node.id, { x: renderedX, width: renderedWidth });
  });

  let lanes: readonly SwimlaneBand[] = [];
  let references: readonly SwimlaneReference[] = [];
  let primaryRowY: ReadonlyMap<string, number> = new Map();
  let scheduledContentEnd: number = ROADMAP_GEOMETRY.scheduledHeaderHeight;
  if (swimlaneModel) {
    const layout = resolveRoadmapSwimlaneLayout({
      boardWidth,
      horizontalGeometry,
      model: swimlaneModel,
      scheduled
    });
    ({ lanes, references, primaryRowY, scheduledContentEnd } = layout);
  } else {
    const rows = new Map<string, number>();
    scheduled.forEach((node, index) => {
      rows.set(
        node.id,
        ROADMAP_GEOMETRY.scheduledHeaderHeight + index * ROADMAP_GEOMETRY.scheduledRowHeight
      );
    });
    primaryRowY = rows;
    scheduledContentEnd += Math.max(58, scheduled.length * ROADMAP_GEOMETRY.scheduledRowHeight);
  }

  schedule?.nodes.forEach((node) => {
    const placement = node.planningPlacement;
    const visiblePlacement = intersectPlanningPlacement(placement, schedule);
    const geometry = horizontalGeometry.get(node.id);
    const rowY = primaryRowY.get(node.id);
    if (!geometry || rowY === undefined) {
      throw new Error(`Roadmap did not resolve scheduled geometry for ${node.id}.`);
    }
    resolvedByNodeId.set(
      node.id,
      roadmapWorkItem({
        boardWidth,
        node,
        placementLabel: placementLabel(placement),
        position: { x: geometry.x, y: rowY },
        width: geometry.width,
        clippedAtStart: visiblePlacement.clippedAtStart,
        clippedAtEnd: visiblePlacement.clippedAtEnd
      })
    );
  });

  const scheduledHeight = scheduledContentEnd + ROADMAP_GEOMETRY.sidePadding;
  const unscheduledY = scheduledHeight + ROADMAP_GEOMETRY.sectionGap;
  const unscheduledGrid = gridLayout({
    boardWidth,
    itemHeight: N2_NODE_HEIGHT,
    itemWidth: N2_NODE_WIDTH,
    nodes: unscheduled,
    regionY: unscheduledY
  });
  for (const item of unscheduledGrid.items) resolvedByNodeId.set(item.node.id, item);

  const notesY = unscheduledY + unscheduledGrid.height + ROADMAP_GEOMETRY.sectionGap;
  const notesGrid = gridLayout({
    boardWidth,
    itemHeight: ROADMAP_GEOMETRY.noteHeight,
    itemWidth: N2_NOTE_WIDTH,
    nodes: notes,
    regionY: notesY
  });
  for (const item of notesGrid.items) resolvedByNodeId.set(item.node.id, item);

  const axis: RoadmapAxis | null = schedule
    ? {
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        x: axisX,
        width: timelineWidth,
        dayWidth: schedule.dayWidth,
        ticks: tickDates(schedule.startDate, schedule.endDate, schedule.dayWidth).map((date) => ({
          date,
          label: formatPlanningDate(date, schedule.dayWidth < 16),
          x: axisX + daysBetween(schedule.startDate, date) * schedule.dayWidth
        }))
      }
    : null;

  return {
    items: graph.nodes.map((node) => {
      const item = resolvedByNodeId.get(node.id);
      if (!item) throw new Error(`Roadmap did not resolve canvas item ${node.id}.`);
      return item;
    }),
    board: {
      width: boardWidth,
      height: notesY + notesGrid.height,
      axis,
      lanes,
      references,
      regions: [
        { id: 'scheduled', count: scheduled.length, y: 0, height: scheduledHeight },
        {
          id: 'unscheduled',
          count: unscheduled.length,
          y: unscheduledY,
          height: unscheduledGrid.height
        },
        { id: 'notes', count: notes.length, y: notesY, height: notesGrid.height }
      ]
    }
  };
};
