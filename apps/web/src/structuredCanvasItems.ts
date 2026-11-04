import type { Position, ProjectedNode, ProjectedNote, ProjectedWorkNode } from '@n2/contracts';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH, N2_NOTE_WIDTH } from './nodeGeometry.js';
import type { ResolvedCanvasItem, StandardResolvedCanvasItem } from './resolvedCanvasItem.js';

export const byAuthoritativePosition = (left: ProjectedNode, right: ProjectedNode): number =>
  left.position.y - right.position.y ||
  left.position.x - right.position.x ||
  left.id.localeCompare(right.id);

export const structuredWorkItem = (
  node: ProjectedWorkNode,
  position: Position,
  draggable = false
): StandardResolvedCanvasItem => ({
  renderer: 'standard',
  node,
  position,
  width: N2_NODE_WIDTH,
  height: N2_NODE_HEIGHT,
  draggable,
  focusable: false
});

export const structuredNoteItem = (
  node: ProjectedNote,
  position: Position,
  height: number
): StandardResolvedCanvasItem => ({
  renderer: 'standard',
  node,
  position,
  width: N2_NOTE_WIDTH,
  height,
  draggable: false,
  focusable: false,
  className: 'n2-canvas-note--folded'
});

export const requireResolvedItem = (
  node: ProjectedNode,
  resolvedByNodeId: ReadonlyMap<string, ResolvedCanvasItem>,
  compositionName: string
): ResolvedCanvasItem => {
  const item = resolvedByNodeId.get(node.id);
  if (!item) throw new Error(`${compositionName} did not resolve canvas item ${node.id}.`);
  return item;
};
