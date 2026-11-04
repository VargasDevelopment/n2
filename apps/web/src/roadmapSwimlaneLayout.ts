import type { ScheduledProjectedWorkNode } from './resolvedCanvasItem.js';
import { ROADMAP_GEOMETRY } from './roadmapGeometry.js';
import type { SwimlaneModel } from './swimlaneModel.js';
import type { SwimlaneBand, SwimlaneReference } from './swimlaneLayout.js';

export type RoadmapSwimlaneLayout = {
  lanes: readonly SwimlaneBand[];
  references: readonly SwimlaneReference[];
  primaryRowY: ReadonlyMap<string, number>;
  scheduledContentEnd: number;
};

type LaneEntry = {
  kind: 'primary' | 'reference';
  node: ScheduledProjectedWorkNode;
};

export const resolveRoadmapSwimlaneLayout = ({
  boardWidth,
  horizontalGeometry,
  model,
  scheduled
}: {
  boardWidth: number;
  horizontalGeometry: ReadonlyMap<string, { x: number; width: number }>;
  model: SwimlaneModel;
  scheduled: readonly ScheduledProjectedWorkNode[];
}): RoadmapSwimlaneLayout => {
  const lanes: SwimlaneBand[] = [];
  const references: SwimlaneReference[] = [];
  const primaryRowY = new Map<string, number>();
  let scheduledContentEnd = ROADMAP_GEOMETRY.scheduledHeaderHeight;

  for (const lane of model.lanes.filter(({ kind }) => kind !== 'notes')) {
    const entries: LaneEntry[] = [];
    const primaryNodeIds = new Set(lane.primaryNodeIds);
    const referenceNodeIds = new Set(lane.referenceNodeIds);
    for (const node of scheduled) {
      if (primaryNodeIds.has(node.id)) entries.push({ kind: 'primary', node });
      else if (referenceNodeIds.has(node.id)) {
        entries.push({ kind: 'reference', node });
      }
    }
    const laneHeight = Math.max(58, entries.length * ROADMAP_GEOMETRY.scheduledRowHeight);

    entries.forEach((entry, index) => {
      const y = scheduledContentEnd + index * ROADMAP_GEOMETRY.scheduledRowHeight;
      if (entry.kind === 'primary') {
        primaryRowY.set(entry.node.id, y);
        return;
      }
      const geometry = horizontalGeometry.get(entry.node.id);
      if (!geometry) return;
      const captionAlignment =
        geometry.x + ROADMAP_GEOMETRY.captionWidth > boardWidth - ROADMAP_GEOMETRY.sidePadding
          ? 'end'
          : 'start';
      references.push({
        presentation: 'temporal',
        laneId: lane.id,
        nodeId: entry.node.id,
        reference: entry.node.reference,
        title: entry.node.title,
        x: geometry.x,
        y: y + ROADMAP_GEOMETRY.placementTop,
        width: geometry.width,
        height: 12,
        placementKind: entry.node.planningPlacement.kind,
        caption: {
          x:
            captionAlignment === 'end'
              ? geometry.x + geometry.width - ROADMAP_GEOMETRY.captionWidth
              : geometry.x,
          y,
          width: ROADMAP_GEOMETRY.captionWidth,
          alignment: captionAlignment
        }
      });
    });
    lanes.push({
      ...lane,
      count: entries.length,
      y: scheduledContentEnd,
      height: laneHeight
    });
    scheduledContentEnd += laneHeight;
  }

  return { lanes, references, primaryRowY, scheduledContentEnd };
};
