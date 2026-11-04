import {
  isWorkNode,
  relationshipEndpointIds,
  type NodeStatus,
  type ProjectedProject
} from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';
import { planningPlacementOverlapsRange, type RoadmapRange } from './roadmapRange.js';

export type CanvasFilters = {
  hiddenStatuses: ReadonlySet<NodeStatus>;
  textQuery: string;
};

export const isTextSearchActive = (textQuery: string): boolean => textQuery.trim().length > 0;

const selectCanvasGraph = (
  graph: CanvasGraph,
  includeNode: (node: CanvasGraph['nodes'][number]) => boolean
): CanvasGraph => {
  const nodes = graph.nodes.filter(includeNode);
  const visibleNodeIds = new Set(nodes.map(({ id }) => id));
  const relationships = graph.relationships.filter((relationship) => {
    const { objectId, subjectId } = relationshipEndpointIds(relationship);
    return visibleNodeIds.has(subjectId) && visibleNodeIds.has(objectId);
  });
  return { nodes, relationships };
};

export const filterCanvas = (
  project: Pick<ProjectedProject, 'nodes' | 'relationships'>,
  { hiddenStatuses, textQuery }: CanvasFilters
): CanvasGraph => {
  const normalizedQuery = textQuery.trim().toLowerCase();
  if (hiddenStatuses.size === 0 && !normalizedQuery) {
    return { nodes: project.nodes, relationships: project.relationships };
  }

  return selectCanvasGraph(
    project,
    (node) =>
      (!isWorkNode(node) || !hiddenStatuses.has(node.effectiveStatus)) &&
      (!normalizedQuery ||
        node.title.toLowerCase().includes(normalizedQuery) ||
        node.reference.toLowerCase().includes(normalizedQuery))
  );
};

export const filterCanvasForRoadmapRange = (
  graph: CanvasGraph,
  roadmapRange: RoadmapRange
): CanvasGraph => {
  return selectCanvasGraph(
    graph,
    (node) =>
      !isWorkNode(node) ||
      !node.planningPlacement ||
      planningPlacementOverlapsRange(node.planningPlacement, roadmapRange)
  );
};
