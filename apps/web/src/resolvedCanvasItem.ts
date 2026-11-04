import type { PlanningPlacement, Position, ProjectedNode, ProjectedWorkNode } from '@n2/contracts';

type ResolvedCanvasItemBase<Node extends ProjectedNode> = {
  node: Node;
  position: Position;
  width: number;
  height?: number;
  minHeight?: number;
  draggable: boolean;
  focusable: boolean;
  className?: string;
};

export type StandardResolvedCanvasItem = ResolvedCanvasItemBase<ProjectedNode> & {
  renderer: 'standard';
};

export type ScheduledProjectedWorkNode = ProjectedWorkNode & {
  planningPlacement: PlanningPlacement;
};

export type RoadmapResolvedCanvasItem = ResolvedCanvasItemBase<ScheduledProjectedWorkNode> & {
  renderer: 'roadmap';
  presentation: {
    placementLabel: string;
    captionAlignment: 'start' | 'end';
    clippedAtStart: boolean;
    clippedAtEnd: boolean;
  };
};

export type ResolvedCanvasItem = StandardResolvedCanvasItem | RoadmapResolvedCanvasItem;
