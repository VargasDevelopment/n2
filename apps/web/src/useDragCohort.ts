import type { Position, ProjectedProject } from '@n2/contracts';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction
} from 'react';
import type { N2CanvasNode } from './canvasNodes.js';
import type { CanvasGraph } from './canvasGraph.js';
import {
  applyAuthoritativePositions,
  beginLocalDrag,
  finishLocalSave,
  prepareLocalSave,
  reconcileCanvasNodes,
  updateLocalDrag,
  type LocalNodePosition
} from './graphReconciliation.js';
import type { NodePositionMove } from './useProjectCommands.js';

export const useDragCohort = ({
  freeform,
  setNodes
}: {
  freeform: {
    graph: CanvasGraph;
    persist: (moves: readonly NodePositionMove[]) => Promise<ProjectedProject | null>;
  } | null;
  setNodes: Dispatch<SetStateAction<N2CanvasNode[]>>;
}) => {
  const latestFreeform = useRef(freeform);
  const localPositions = useRef(new Map<string, LocalNodePosition>());

  useLayoutEffect(() => {
    latestFreeform.current = freeform;
    if (!freeform) localPositions.current.clear();
  }, [freeform]);

  const start = useCallback((draggedNodes: N2CanvasNode[]): void => {
    if (!latestFreeform.current) return;
    for (const canvasNode of draggedNodes) {
      beginLocalDrag(localPositions.current, canvasNode.id, canvasNode.position);
    }
  }, []);

  const update = useCallback((draggedNodes: N2CanvasNode[]): void => {
    if (!latestFreeform.current) return;
    for (const canvasNode of draggedNodes) {
      updateLocalDrag(localPositions.current, canvasNode.id, canvasNode.position);
    }
  }, []);

  const reset = useCallback((): void => {
    localPositions.current.clear();
  }, []);

  const stop = useCallback(
    (canvasNodes: N2CanvasNode[]): void => {
      const currentFreeform = latestFreeform.current;
      if (!currentFreeform) return;
      const authoritativePositionByNodeId = new Map(
        currentFreeform.graph.nodes.map((node) => [node.id, node.position])
      );
      const revisionByNodeId = new Map<string, symbol>();
      const unchangedPositions = new Map<string, Position>();
      const moves = canvasNodes.flatMap((canvasNode) => {
        const revision = prepareLocalSave(
          localPositions.current,
          canvasNode.id,
          canvasNode.position
        );
        const authoritativePosition = authoritativePositionByNodeId.get(canvasNode.id);
        if (!authoritativePosition) {
          if (revision !== null) {
            finishLocalSave(localPositions.current, canvasNode.id, revision);
          }
          return [];
        }
        if (revision === null) {
          unchangedPositions.set(canvasNode.id, authoritativePosition);
          return [];
        }
        revisionByNodeId.set(canvasNode.id, revision);
        return [{ nodeId: canvasNode.id, position: canvasNode.position }];
      });

      if (unchangedPositions.size > 0) {
        setNodes((currentNodes) => applyAuthoritativePositions(currentNodes, unchangedPositions));
      }
      if (moves.length === 0) return;

      void currentFreeform.persist(moves).then((authoritativeProject) => {
        const authoritativePositionByNodeId = new Map(
          authoritativeProject?.nodes.map((node) => [node.id, node.position]) ?? []
        );
        const acknowledgedNodeIds = new Set(
          moves.flatMap(({ nodeId }) => {
            const revision = revisionByNodeId.get(nodeId);
            return revision !== undefined &&
              finishLocalSave(localPositions.current, nodeId, revision)
              ? [nodeId]
              : [];
          })
        );
        if (acknowledgedNodeIds.size === 0) return;
        const acknowledgedPositions = new Map(
          [...authoritativePositionByNodeId].filter(([nodeId]) => acknowledgedNodeIds.has(nodeId))
        );
        setNodes((currentNodes) =>
          applyAuthoritativePositions(currentNodes, acknowledgedPositions)
        );
      });
    },
    [setNodes]
  );

  const reconcile = useCallback(
    (currentNodes: N2CanvasNode[], nextNodes: N2CanvasNode[]): N2CanvasNode[] =>
      reconcileCanvasNodes(currentNodes, nextNodes, localPositions.current),
    []
  );

  return useMemo(
    () => ({ reconcile, reset, start, stop, update }),
    [reconcile, reset, start, stop, update]
  );
};
