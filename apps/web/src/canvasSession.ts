import type {
  NodeKind,
  NodeStatus,
  Position,
  ProjectedProject,
  ProjectedWorkNode
} from '@n2/contracts';
import type {
  FreeformCanvasView,
  KanbanCanvasView,
  RoadmapCanvasView,
  SwimlaneCanvasView
} from './canvasView.js';
import type { RoadmapRange } from './roadmapRange.js';
import type { NodePositionMove } from './useProjectCommands.js';

export type CanvasSession =
  | {
      kind: 'freeform';
      view: FreeformCanvasView;
      onCreateNode: (kind: NodeKind, position: Position) => void;
      onMoveNodes: (moves: readonly NodePositionMove[]) => Promise<ProjectedProject | null>;
    }
  | {
      kind: 'kanban';
      view: KanbanCanvasView;
      onSetRequestedStatus: (node: ProjectedWorkNode, status: NodeStatus) => void;
    }
  | {
      kind: 'roadmap';
      view: RoadmapCanvasView;
      isAutomaticRange: boolean;
      onSetRoadmapRange: (range: RoadmapRange) => void;
      onResetRoadmapRange: () => void;
    }
  | {
      kind: 'swimlane';
      view: SwimlaneCanvasView;
    };
