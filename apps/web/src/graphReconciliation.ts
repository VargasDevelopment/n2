import type { Position } from '@n2/contracts';
import type { N2CanvasNode } from './canvasNodes.js';

export type LocalNodePosition = {
  origin: Position;
  revision: symbol;
  position: Position;
};

export const beginLocalDrag = (
  localPositions: Map<string, LocalNodePosition>,
  nodeId: string,
  position: Position
): void => {
  localPositions.set(nodeId, { origin: position, revision: Symbol(nodeId), position });
};

export const updateLocalDrag = (
  localPositions: Map<string, LocalNodePosition>,
  nodeId: string,
  position: Position
): void => {
  const current = localPositions.get(nodeId);
  if (!current) return;
  localPositions.set(nodeId, { ...current, position });
};

const positionsAreEqual = (left: Position, right: Position): boolean =>
  left.x === right.x && left.y === right.y;

const shallowRecordsAreEqual = (left: object | undefined, right: object | undefined): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftEntries = Object.entries(leftRecord);
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => Object.is(value, rightRecord[key]))
  );
};

const geometryIsUnchanged = (current: N2CanvasNode, next: N2CanvasNode): boolean =>
  current.width === next.width &&
  current.height === next.height &&
  current.className === next.className &&
  shallowRecordsAreEqual(current.style, next.style);

export const prepareLocalSave = (
  localPositions: Map<string, LocalNodePosition>,
  nodeId: string,
  position: Position
): symbol | null => {
  const current = localPositions.get(nodeId);
  if (!current || positionsAreEqual(current.origin, position)) {
    localPositions.delete(nodeId);
    return null;
  }
  localPositions.set(nodeId, { ...current, position });
  return current.revision;
};

export const finishLocalSave = (
  localPositions: Map<string, LocalNodePosition>,
  nodeId: string,
  revision: symbol
): boolean => {
  if (localPositions.get(nodeId)?.revision !== revision) return false;
  localPositions.delete(nodeId);
  return true;
};

export const applyAuthoritativePositions = (
  nodes: N2CanvasNode[],
  positionsByNodeId: ReadonlyMap<string, Position>
): N2CanvasNode[] => {
  let nextNodes: N2CanvasNode[] | null = null;
  for (const [index, node] of nodes.entries()) {
    const position = positionsByNodeId.get(node.id);
    if (!position || positionsAreEqual(node.position, position)) {
      nextNodes?.push(node);
      continue;
    }
    nextNodes ??= nodes.slice(0, index);
    nextNodes.push({ ...node, position });
  }
  return nextNodes ?? nodes;
};

export const reconcileCanvasNodes = (
  currentNodes: N2CanvasNode[],
  nextNodes: N2CanvasNode[],
  localPositions: Map<string, LocalNodePosition>
): N2CanvasNode[] => {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);
    // The resolver owns the complete public node presentation. Preserve only React Flow's measured
    // runtime cache when the resolved geometry is unchanged; spreading the current public node
    // would let stale structured-view fields leak from one composition into the next.
    const reconciledNode: N2CanvasNode = {
      ...nextNode,
      ...(currentNode?.measured && geometryIsUnchanged(currentNode, nextNode)
        ? { measured: currentNode.measured }
        : {})
    };
    const localPosition = localPositions.get(nextNode.id);
    if (localPosition) {
      return {
        ...reconciledNode,
        position: localPosition.position,
        ...(currentNode?.dragging === undefined ? {} : { dragging: currentNode.dragging })
      };
    }
    if (currentNode?.dragging) {
      return { ...reconciledNode, position: currentNode.position, dragging: true };
    }
    return reconciledNode;
  });
};
