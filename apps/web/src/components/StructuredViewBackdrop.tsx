import type { NodeStatus } from '@n2/contracts';
import type { CanvasView } from '../canvasView.js';
import { KanbanBackdrop } from './KanbanBackdrop.js';
import { RoadmapBackdrop } from './RoadmapBackdrop.js';
import { SwimlaneBackdrop } from './SwimlaneBackdrop.js';

export function StructuredViewBackdrop({
  dropTarget,
  view
}: {
  dropTarget: NodeStatus | null;
  view: CanvasView;
}) {
  switch (view.layout) {
    case 'kanban':
      return <KanbanBackdrop board={view.board} dropTarget={dropTarget} />;
    case 'roadmap':
      return <RoadmapBackdrop board={view.board} />;
    case 'swimlane':
      return <SwimlaneBackdrop board={view.board} />;
    case 'freeform':
      return null;
  }
}
