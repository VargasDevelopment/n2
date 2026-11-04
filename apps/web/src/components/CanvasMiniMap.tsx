import { MiniMap } from '@xyflow/react';
import type { N2CanvasNode } from '../canvasNodes.js';
import { canvasItemMiniMapColor } from '../statusPresentation.js';

const nodeColor = (node: N2CanvasNode): string => canvasItemMiniMapColor(node.data.node);

export function CanvasMiniMap({ visible }: { visible: boolean }) {
  return visible ? (
    <MiniMap<N2CanvasNode>
      pannable
      zoomable
      nodeColor={nodeColor}
      maskColor="var(--color-minimap-mask)"
    />
  ) : null;
}
