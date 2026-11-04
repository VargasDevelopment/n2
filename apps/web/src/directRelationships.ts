import { isWorkNode, type ProjectedWorkNode } from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';

export type DirectlyRelatedWorkNode = {
  relationshipId: string;
  node: ProjectedWorkNode;
  /** False when the current canvas view hides the related node, so it cannot be selected. */
  isVisible: boolean;
};

export type DirectRelationships = {
  /** Dependencies of the subject: the work it Depends on. */
  dependencies: DirectlyRelatedWorkNode[];
  /** Dependents of the subject: the work that Depends on it. */
  dependents: DirectlyRelatedWorkNode[];
  /** Groups the subject is a Member of. */
  groups: DirectlyRelatedWorkNode[];
  /** Direct members of the subject when it is a Group: the work that is a Member of it. */
  members: DirectlyRelatedWorkNode[];
};

const byReference = (left: DirectlyRelatedWorkNode, right: DirectlyRelatedWorkNode): number =>
  left.node.reference.localeCompare(right.node.reference, undefined, { numeric: true });

/**
 * Reads a Work Node's direct relationship context from the authoritative project graph rather
 * than the filtered canvas view, so filters never misrepresent what the work depends on.
 */
export const directRelationships = (
  graph: CanvasGraph,
  nodeId: string,
  visibleNodeIds: ReadonlySet<string>
): DirectRelationships => {
  const workNodeById = new Map(
    graph.nodes.filter(isWorkNode).map((candidate) => [candidate.id, candidate])
  );
  const result: DirectRelationships = { dependencies: [], dependents: [], groups: [], members: [] };
  const add = (
    entries: DirectlyRelatedWorkNode[],
    relationshipId: string,
    relatedNodeId: string
  ): void => {
    const node = workNodeById.get(relatedNodeId);
    if (node) entries.push({ relationshipId, node, isVisible: visibleNodeIds.has(node.id) });
  };

  for (const relationship of graph.relationships) {
    if (relationship.kind === 'member_of') {
      if (relationship.memberId === nodeId) {
        add(result.groups, relationship.id, relationship.groupId);
      } else if (relationship.groupId === nodeId) {
        add(result.members, relationship.id, relationship.memberId);
      }
    } else if (relationship.dependentId === nodeId) {
      add(result.dependencies, relationship.id, relationship.dependencyId);
    } else if (relationship.dependencyId === nodeId) {
      add(result.dependents, relationship.id, relationship.dependentId);
    }
  }

  for (const entries of Object.values(result)) entries.sort(byReference);
  return result;
};
