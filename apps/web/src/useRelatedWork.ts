import { isWorkNode, type ProjectedNode } from '@n2/contracts';
import { useMemo } from 'react';
import type { CanvasGraph } from './canvasGraph.js';
import type { RelatedWork } from './components/InspectorRelationships.js';
import { directRelationships } from './directRelationships.js';

/**
 * Derives the selected Work Node's direct relationships from the loaded project, so they follow
 * every authoritative refresh. Choosing one goes to it through `onNavigate`; removing one goes
 * through `onRemove`.
 */
export const useRelatedWork = ({
  project,
  visibleGraph,
  selectedNode,
  onNavigate,
  onRemove
}: {
  project: CanvasGraph | undefined;
  visibleGraph: CanvasGraph | null;
  selectedNode: ProjectedNode | null;
  onNavigate: (nodeId: string) => void;
  onRemove: (relationshipId: string) => Promise<void>;
}): RelatedWork | undefined =>
  useMemo(
    () =>
      project && visibleGraph && selectedNode && isWorkNode(selectedNode)
        ? {
            items: directRelationships(
              project,
              selectedNode.id,
              new Set(visibleGraph.nodes.map(({ id }) => id))
            ),
            onNavigate,
            onRemove
          }
        : undefined,
    [onNavigate, onRemove, project, selectedNode, visibleGraph]
  );
