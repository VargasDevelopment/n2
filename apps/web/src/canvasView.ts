import type { ProjectedNode } from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';
import { filterCanvasForRoadmapRange } from './canvasFilter.js';
import { resolveKanban, type KanbanBoard } from './kanbanView.js';
import {
  N2_NODE_HEIGHT,
  N2_NODE_WIDTH,
  N2_NOTE_MIN_HEIGHT,
  N2_NOTE_WIDTH
} from './nodeGeometry.js';
import type { ResolvedCanvasItem, StandardResolvedCanvasItem } from './resolvedCanvasItem.js';
import { resolveRoadmap, type RoadmapBoard } from './roadmapView.js';
import type { RoadmapRange } from './roadmapRange.js';
import { resolveLaneScopeId, resolveSwimlaneModel, type SwimlaneModel } from './swimlaneModel.js';
import { resolveSwimlane, type SwimlaneBoard } from './swimlaneView.js';

export type { ResolvedCanvasItem } from './resolvedCanvasItem.js';
export { kanbanStatusAtX, KANBAN_CARD_GAP, KANBAN_NOTE_HEIGHT } from './kanbanView.js';

export type CanvasTransformationId = 'kanban' | 'roadmap' | 'swimlane';
export type CanvasLayout = 'freeform' | 'kanban' | 'roadmap' | 'swimlane';
export type CanvasCompositionKey = CanvasLayout | 'kanban+swimlane' | 'roadmap+swimlane';

type CanvasViewBase = {
  graph: CanvasGraph;
  items: readonly ResolvedCanvasItem[];
};

export type FreeformCanvasView = CanvasViewBase & {
  layout: 'freeform';
  capabilities: {
    nodeCreation: true;
    authoritativePositionWrites: true;
    statusColumnDrops: false;
    multiSelection: true;
  };
};

type StructuredCapabilities = {
  nodeCreation: false;
  authoritativePositionWrites: false;
  multiSelection: false;
};

export type KanbanCanvasView = CanvasViewBase & {
  layout: 'kanban';
  capabilities: StructuredCapabilities & {
    statusColumnDrops: true;
  };
  board: KanbanBoard;
  swimlaneModel: SwimlaneModel | null;
};

export type RoadmapCanvasView = CanvasViewBase & {
  layout: 'roadmap';
  capabilities: StructuredCapabilities & {
    statusColumnDrops: false;
  };
  board: RoadmapBoard;
  swimlaneModel: SwimlaneModel | null;
};

export type SwimlaneCanvasView = CanvasViewBase & {
  layout: 'swimlane';
  capabilities: StructuredCapabilities & {
    statusColumnDrops: false;
  };
  board: SwimlaneBoard;
  swimlaneModel: SwimlaneModel;
};

export type CanvasView =
  FreeformCanvasView | KanbanCanvasView | RoadmapCanvasView | SwimlaneCanvasView;

export const isKanbanCanvasView = (view: CanvasView): view is KanbanCanvasView =>
  view.layout === 'kanban';

export const isRoadmapCanvasView = (view: CanvasView): view is RoadmapCanvasView =>
  view.layout === 'roadmap';

export const isSwimlaneCanvasView = (view: CanvasView): view is SwimlaneCanvasView =>
  view.layout === 'swimlane';

export type StructuredCanvasView = Exclude<CanvasView, FreeformCanvasView>;

export const isStructuredCanvasView = (view: CanvasView): view is StructuredCanvasView =>
  view.layout !== 'freeform';

export const canvasCompositionKey = (view: CanvasView): CanvasCompositionKey => {
  if (view.layout === 'kanban' && view.swimlaneModel) return 'kanban+swimlane';
  if (view.layout === 'roadmap' && view.swimlaneModel) return 'roadmap+swimlane';
  return view.layout;
};

export const canvasTransformations = (view: CanvasView): readonly CanvasTransformationId[] => {
  if (view.layout === 'freeform') return [];
  if (view.layout === 'swimlane') return ['swimlane'];
  return view.swimlaneModel ? [view.layout, 'swimlane'] : [view.layout];
};

export type CanvasViewOptions = {
  roadmapRange?: RoadmapRange | null;
  swimlaneScopeId?: string | null;
};

const freeformItem = (node: ProjectedNode): StandardResolvedCanvasItem => ({
  renderer: 'standard',
  node,
  position: node.position,
  width: node.kind === 'note' ? N2_NOTE_WIDTH : N2_NODE_WIDTH,
  ...(node.kind === 'note' ? { minHeight: N2_NOTE_MIN_HEIGHT } : { height: N2_NODE_HEIGHT }),
  draggable: true,
  focusable: true
});

const visibleSwimlaneModel = (graph: CanvasGraph, requestedScopeId: string | null): SwimlaneModel =>
  resolveSwimlaneModel(graph, resolveLaneScopeId(graph, requestedScopeId));

const resolveKanbanView = (
  graph: CanvasGraph,
  swimlaneModel: SwimlaneModel | null
): KanbanCanvasView => ({
  layout: 'kanban',
  capabilities: {
    nodeCreation: false,
    authoritativePositionWrites: false,
    statusColumnDrops: true,
    multiSelection: false
  },
  graph,
  ...resolveKanban(graph, swimlaneModel),
  swimlaneModel
});

const resolveRoadmapView = (
  graph: CanvasGraph,
  roadmapRange: RoadmapRange | null,
  requestedSwimlaneScopeId: string | null,
  withSwimlanes: boolean
): RoadmapCanvasView => {
  const visibleGraph = roadmapRange ? filterCanvasForRoadmapRange(graph, roadmapRange) : graph;
  const swimlaneModel = withSwimlanes
    ? visibleSwimlaneModel(visibleGraph, requestedSwimlaneScopeId)
    : null;
  return {
    layout: 'roadmap',
    capabilities: {
      nodeCreation: false,
      authoritativePositionWrites: false,
      statusColumnDrops: false,
      multiSelection: false
    },
    graph: visibleGraph,
    ...resolveRoadmap(visibleGraph, roadmapRange, swimlaneModel),
    swimlaneModel
  };
};

const resolveSwimlaneView = (graph: CanvasGraph, model: SwimlaneModel): SwimlaneCanvasView => ({
  layout: 'swimlane',
  capabilities: {
    nodeCreation: false,
    authoritativePositionWrites: false,
    statusColumnDrops: false,
    multiSelection: false
  },
  graph,
  ...resolveSwimlane(graph, model),
  swimlaneModel: model
});

export const resolveCanvasView = (
  graph: CanvasGraph,
  transformations: ReadonlySet<CanvasTransformationId>,
  options: CanvasViewOptions = {}
): CanvasView => {
  if (transformations.size === 0) {
    return {
      layout: 'freeform',
      capabilities: {
        nodeCreation: true,
        authoritativePositionWrites: true,
        statusColumnDrops: false,
        multiSelection: true
      },
      graph,
      items: graph.nodes.map(freeformItem)
    };
  }

  const hasKanban = transformations.has('kanban');
  const hasRoadmap = transformations.has('roadmap');
  const hasSwimlane = transformations.has('swimlane');
  if (hasKanban && hasRoadmap) {
    throw new Error(
      `Unsupported canvas transformation set: ${[...transformations].sort().join(', ')}`
    );
  }
  if (hasKanban) {
    const model = hasSwimlane ? visibleSwimlaneModel(graph, options.swimlaneScopeId ?? null) : null;
    return resolveKanbanView(graph, model);
  }
  if (hasRoadmap) {
    return resolveRoadmapView(
      graph,
      options.roadmapRange ?? null,
      options.swimlaneScopeId ?? null,
      hasSwimlane
    );
  }
  if (hasSwimlane) {
    return resolveSwimlaneView(graph, visibleSwimlaneModel(graph, options.swimlaneScopeId ?? null));
  }
  throw new Error(
    `Unsupported canvas transformation set: ${[...transformations].sort().join(', ')}`
  );
};

type TransformationConflict<Transformation extends string> = readonly [
  Transformation,
  Transformation
];

const transformationConflicts: readonly TransformationConflict<CanvasTransformationId>[] = [
  ['kanban', 'roadmap']
];

export const toggleTransformationInSet = <Transformation extends string>(
  current: ReadonlySet<Transformation>,
  selected: Transformation,
  conflicts: readonly TransformationConflict<Transformation>[]
): ReadonlySet<Transformation> => {
  const next = new Set(current);
  if (next.has(selected)) {
    next.delete(selected);
    return next;
  }
  for (const [left, right] of conflicts) {
    if (selected === left) next.delete(right);
    if (selected === right) next.delete(left);
  }
  next.add(selected);
  return next;
};

export const toggleCanvasTransformation = (
  current: ReadonlySet<CanvasTransformationId>,
  selected: CanvasTransformationId
): ReadonlySet<CanvasTransformationId> =>
  toggleTransformationInSet(current, selected, transformationConflicts);
