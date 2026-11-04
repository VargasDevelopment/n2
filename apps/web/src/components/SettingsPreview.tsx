import type { SettingsValues } from '@n2/contracts';
import { Background, BackgroundVariant, MiniMap, ReactFlow } from '@xyflow/react';
import { useMemo } from 'react';
import { createConnectionHighlightController } from '../connectionHighlightDom.js';
import { settingsPreviewEdges, settingsPreviewNodes } from '../settingsPreviewModel.js';
import { canvasItemMiniMapColor } from '../statusPresentation.js';
import { N2Edge, type N2CanvasEdge } from './N2Edge.js';
import { N2Node, type StandardCanvasNode } from './N2Node.js';
import { ConnectionHighlightProvider } from './ConnectionHighlightProvider.js';
import './SettingsPreview.css';

// The preview is a sample of the real canvas, so its minimap uses the same status colors.
const previewMiniMapColor = (node: StandardCanvasNode): string =>
  canvasItemMiniMapColor(node.data.node);

const nodeTypes = { n2: N2Node };
const edgeTypes = { n2: N2Edge };

export function SettingsPreview({ values }: { values: SettingsValues }) {
  const controller = useMemo(() => createConnectionHighlightController(), []);
  const desiredNodes = useMemo(
    () => settingsPreviewNodes(values.handleOrientation),
    [values.handleOrientation]
  );
  const edges = useMemo(() => settingsPreviewEdges(), []);

  return (
    <section className="settings-preview" aria-label="Settings preview">
      <header>
        <span>Live preview</span>
        <small>Read-only</small>
      </header>
      <div className="settings-preview__canvas" inert>
        <ConnectionHighlightProvider controller={controller}>
          <ReactFlow<StandardCanvasNode, N2CanvasEdge>
            key={values.handleOrientation}
            defaultNodes={desiredNodes}
            defaultEdges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            defaultViewport={{ x: 12, y: 16, zoom: 0.7 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.1}
              color="var(--color-canvas-dots)"
            />
            {values.minimapVisible ? (
              <MiniMap<StandardCanvasNode>
                nodeColor={previewMiniMapColor}
                maskColor="var(--color-minimap-mask)"
                ariaLabel="Preview minimap"
              />
            ) : null}
          </ReactFlow>
        </ConnectionHighlightProvider>
      </div>
      <p>
        Handles are {values.handleOrientation === 'horizontal' ? 'left → right' : 'top → bottom'}.
        The canvas stays exactly where it is. Roadmap stays left → right.
      </p>
    </section>
  );
}
