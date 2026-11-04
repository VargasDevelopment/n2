import {
  type CreateRelationshipInput,
  type NodeKind,
  type ProjectedNode,
  type ProjectedWorkNode,
  type RelationshipKind,
  type SettingsValues
} from '@n2/contracts';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';
import { createPortal } from 'react-dom';
import { toCanvasEdges } from '../canvasEdges.js';
import { presentCanvasNodes, toCanvasNodes, type N2CanvasNode } from '../canvasNodes.js';
import type { CanvasSession } from '../canvasSession.js';
import type { CanvasTransformationId } from '../canvasView.js';
import { indexConnectionHighlights } from '../connectionHighlight.js';
import { createConnectionHighlightController } from '../connectionHighlightDom.js';
import {
  applySelectionChanges,
  inspectorPlacementForBounds,
  noSelection,
  relationshipInput,
  selectionPresentInGraph,
  selectionSubject,
  type CanvasSelection,
  type GraphSelection,
  type SelectionChange
} from '../graphInteraction.js';
import {
  N2_NODE_HEIGHT,
  N2_NODE_WIDTH,
  N2_NOTE_MIN_HEIGHT,
  N2_NOTE_WIDTH
} from '../nodeGeometry.js';
import type { NoteExpansionControls } from '../noteFold.js';
import { useCanvasInteractionController } from '../useCanvasInteractionController.js';
import { useCanvasKeyboardShortcuts } from '../useCanvasKeyboardShortcuts.js';
import type { CanvasFocusRequest } from '../useCanvasFocusRequest.js';
import { canvasMinZoom, useCanvasModeViewport } from '../useCanvasModeViewport.js';
import { useViewportAuthorship } from '../viewportAuthorship.js';
import { usePaneClickCoordinator } from '../usePaneClickCoordinator.js';
import { useRelationshipPresentation } from '../useRelationshipPresentation.js';
import { useViewportCompositorHint } from '../useViewportCompositorHint.js';
import { N2Edge, type N2CanvasEdge } from './N2Edge.js';
import { ConnectionHighlightProvider } from './ConnectionHighlightProvider.js';
import { N2Node, type N2NodeActions } from './N2Node.js';
import { RoadmapNode } from './RoadmapNode.js';
import {
  CanvasToolbar,
  type CanvasFilterControls,
  type NodeToolActivation
} from './CanvasToolbar.js';
import { CanvasViewControls } from './CanvasViewSwitcher.js';
import { CanvasHint } from './CanvasHint.js';
import { CanvasFraming } from './CanvasFraming.js';
import { CanvasMiniMap } from './CanvasMiniMap.js';
import { GroupRegionLayer, type ZoomTier } from './GroupRegionLayer.js';
import { StructuredViewBackdrop } from './StructuredViewBackdrop.js';

const CANVAS_MAX_ZOOM = 1.8;
// Stable, so a canvas without an owner for its focus requests does not restart them each render.
const ignoreFocusSettled = (): void => undefined;
const nodeTypes = { n2: N2Node, roadmap: RoadmapNode };
const edgeTypes = { n2: N2Edge };

/** React Flow's selection reports, as changes to the one selection store. */
const selectionChanges = (
  item: SelectionChange['item'],
  changes: readonly (NodeChange<N2CanvasNode> | EdgeChange<N2CanvasEdge>)[]
): SelectionChange[] =>
  changes.flatMap((change) =>
    change.type === 'select' ? [{ item, id: change.id, selected: change.selected }] : []
  );

const isGraphItemInteractionTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('.react-flow__node, .react-flow__edge') !== null;

export function GraphCanvas({
  canvasSession,
  settings,
  selection,
  focusRequest = null,
  onFocusSettled = ignoreFocusSettled,
  onPersonMovedViewport = () => undefined,
  onCreateRelationship,
  onDeleteSelection,
  onDeleteRelationship,
  onRenameNode,
  onCycleStatus,
  onSelectionChange,
  keyboardShortcutsEnabled = true,
  filterControls,
  noteExpansion,
  onSetSwimlaneScopeId,
  onToggleTransformation,
  onShowFreeform
}: {
  canvasSession: CanvasSession;
  settings: SettingsValues;
  selection: GraphSelection;
  focusRequest?: CanvasFocusRequest | null;
  /** The focus request's pan has ended, so the request is spent. */
  onFocusSettled?: (request: CanvasFocusRequest) => void;
  /** The one signal that the person moved the viewport, by any means; N2's own moves never send it. */
  onPersonMovedViewport?: () => void;
  onCreateRelationship: (input: CreateRelationshipInput) => void;
  /** Deletes a selection with nodes in it; a relationship alone uses onDeleteRelationship. */
  onDeleteSelection: (selection: CanvasSelection) => void;
  onDeleteRelationship: (relationshipId: string) => Promise<void>;
  onRenameNode: (node: ProjectedNode, title: string) => Promise<ProjectedNode | null>;
  onCycleStatus: (node: ProjectedWorkNode) => void;
  /** The canvas owns no selection: every change, React Flow's included, goes through here. */
  onSelectionChange: Dispatch<SetStateAction<GraphSelection>>;
  keyboardShortcutsEnabled?: boolean;
  filterControls: CanvasFilterControls;
  /** Owned with the rest of the Canvas view state, which sees the Project and not just the view. */
  noteExpansion: NoteExpansionControls;
  onSetSwimlaneScopeId: (groupId: string) => void;
  onToggleTransformation: (transformation: CanvasTransformationId) => void;
  onShowFreeform: () => void;
}) {
  const view = canvasSession.view;
  const graph = view.graph;
  const { handleOrientation, minimapVisible } = settings;
  const [nodeKind, setNodeKind] = useState<NodeKind>('task');
  const [placementKind, setPlacementKind] = useState<NodeKind | null>(null);
  const [relationshipKind, setRelationshipKind] = useState<RelationshipKind>('member_of');
  const canvasWrap = useRef<HTMLElement | null>(null);
  const flow = useRef<ReactFlowInstance<N2CanvasNode, N2CanvasEdge> | null>(null);
  const latestGraph = useRef(graph);
  const paneClicks = usePaneClickCoordinator();
  const { beginViewportTransform, isViewportTransforming, settleViewportTransform } =
    useViewportCompositorHint();
  const { expansion, toggleNoteFold, touchNote } = noteExpansion;
  const actions = useMemo<N2NodeActions>(
    () => ({
      cycleStatus: onCycleStatus,
      deleteNode: (node) => onDeleteSelection({ nodeIds: [node.id], relationshipIds: [] }),
      rename: onRenameNode,
      toggleNoteFold,
      touchNote
    }),
    [onCycleStatus, onDeleteSelection, onRenameNode, toggleNoteFold, touchNote]
  );
  const connectionHighlights = useMemo(
    () => indexConnectionHighlights(graph.relationships),
    [graph.relationships]
  );
  const connectionHighlightController = useMemo(() => createConnectionHighlightController(), []);
  const setCanvasWrap = useCallback(
    (element: HTMLElement | null): void => {
      canvasWrap.current = element;
      connectionHighlightController.setRoot(element);
    },
    [connectionHighlightController]
  );
  // Node state holds geometry and drag state only; selection and expanded Notes are applied below.
  const [nodes, setNodes, onNodesChange] = useNodesState<N2CanvasNode>(
    toCanvasNodes(view, actions, handleOrientation)
  );
  const applyGraphSelection = useCallback(
    (nextSelection: SetStateAction<GraphSelection>): void => {
      setPlacementKind(null);
      onSelectionChange(nextSelection);
    },
    [onSelectionChange]
  );
  const subject = selectionSubject(selection);
  const selectedNodeId = subject?.kind === 'node' ? subject.nodeId : null;
  const selectedRelationship =
    subject?.kind === 'relationship'
      ? graph.relationships.find(({ id }) => id === subject.relationshipId)
      : undefined;
  const renderedNodes = useMemo(
    () => presentCanvasNodes(nodes, new Set(selection.nodeIds), expansion),
    [expansion, nodes, selection.nodeIds]
  );
  const [zoomTier, setZoomTier] = useState<ZoomTier>('detail');
  const relationships = useRelationshipPresentation({
    graph,
    layout: view.layout,
    selection,
    connectionHighlights
  });
  const edges = useMemo(
    () => toCanvasEdges(graph, new Set(selection.relationshipIds), relationships),
    [graph, relationships, selection.relationshipIds]
  );

  useLayoutEffect(() => {
    latestGraph.current = graph;
  }, [graph]);

  useLayoutEffect(() => {
    const hoveredNodeId = connectionHighlightController.getActiveNodeId();
    if (hoveredNodeId && graph.nodes.some(({ id }) => id === hoveredNodeId)) {
      connectionHighlightController.activate(
        hoveredNodeId,
        connectionHighlights.get(hoveredNodeId)
      );
    } else {
      connectionHighlightController.clear();
    }
  }, [connectionHighlightController, connectionHighlights, graph.nodes]);

  const createNodeAtClientPoint = useCallback(
    (kind: NodeKind, clientX: number, clientY: number): void => {
      const instance = flow.current;
      if (!instance) return;
      const point = instance.screenToFlowPosition({ x: clientX, y: clientY });
      const width = kind === 'note' ? N2_NOTE_WIDTH : N2_NODE_WIDTH;
      const height = kind === 'note' ? N2_NOTE_MIN_HEIGHT : N2_NODE_HEIGHT;
      if (canvasSession.kind !== 'freeform') return;
      canvasSession.onCreateNode(kind, {
        x: point.x - width / 2,
        y: point.y - height / 2
      });
    },
    [canvasSession]
  );

  const createNodeAtCanvasCenter = useCallback(
    (kind: NodeKind): void => {
      const bounds = canvasWrap.current?.getBoundingClientRect();
      if (!bounds) return;
      createNodeAtClientPoint(kind, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    },
    [createNodeAtClientPoint]
  );

  const handleFreeformPaneClick = (event: {
    clientX: number;
    clientY: number;
    detail: number;
  }): void => {
    if (placementKind !== null && event.detail === 1) {
      paneClicks.current?.commitPlacement({
        dismissSelection: () => applyGraphSelection(noSelection),
        place: () => {
          createNodeAtClientPoint(placementKind, event.clientX, event.clientY);
          setPlacementKind(null);
        }
      });
      return;
    }
    paneClicks.current?.handle(event.detail, {
      createNode: () => createNodeAtClientPoint(nodeKind, event.clientX, event.clientY),
      dismissSelection: () => applyGraphSelection(noSelection),
      restoreSelection: () => {
        applyGraphSelection(selectionPresentInGraph(selection, latestGraph.current));
      }
    });
  };

  const interactions = useCanvasInteractionController({
    actions,
    canvasSession,
    handleOrientation,
    onFreeformPaneClick: handleFreeformPaneClick,
    onStructuredPaneClick: () => applyGraphSelection(noSelection),
    setNodes,
    onNodesChange
  });
  const reconcileViewNodes = interactions.reconcile;

  const activateNodeTool = ({ kind, method }: NodeToolActivation): void => {
    interactions.reset();
    paneClicks.current?.reset();
    setNodeKind(kind);
    if (method === 'pointer') {
      applyGraphSelection(noSelection);
      setPlacementKind(kind);
      return;
    }
    setPlacementKind(null);
    createNodeAtCanvasCenter(kind);
  };

  useEffect(() => {
    setNodes((currentNodes) =>
      reconcileViewNodes(currentNodes, toCanvasNodes(view, actions, handleOrientation))
    );
  }, [actions, handleOrientation, reconcileViewNodes, setNodes, view]);

  const viewportAuthorship = useViewportAuthorship(onPersonMovedViewport);
  const { writeOwnViewport, hasPersonMoved } = viewportAuthorship;
  useCanvasModeViewport({ canvasWrap, flow, view, writeOwnViewport });
  const freeRegion = useRef<HTMLDivElement | null>(null);

  const deletingRelationshipIds = useCanvasKeyboardShortcuts({
    canvas: canvasWrap,
    enabled: keyboardShortcutsEnabled,
    graph,
    selection,
    placementActive: placementKind !== null,
    paneClicks,
    setPlacementKind,
    applyGraphSelection,
    onDeleteSelection,
    onDeleteRelationship
  });

  // Clicks, modifier toggles, marquees and pane resets all arrive as React Flow select changes.
  const followSelectionChanges = (changes: readonly SelectionChange[]): void => {
    if (changes.length > 0) {
      applyGraphSelection((current) => applySelectionChanges(current, changes));
    }
  };

  const handleConnect = useCallback(
    (connection: Connection): void => {
      if (!connection.source || !connection.target) return;
      onCreateRelationship(
        relationshipInput(graph, connection.source, connection.target, relationshipKind)
      );
    },
    [onCreateRelationship, relationshipKind, graph]
  );

  return (
    <section
      ref={setCanvasWrap}
      className={`canvas-wrap${placementKind ? ' canvas-wrap--placing' : ''}`}
      data-viewport-transforming={isViewportTransforming || undefined}
      data-relationship-focus-active={relationships.focusActive || undefined}
      data-zoom-tier={relationships.groupRegions ? zoomTier : undefined}
      aria-label="N2 graph canvas"
      onPointerDownCapture={(event) => {
        if (isGraphItemInteractionTarget(event.target)) paneClicks.current?.reset();
      }}
      onClickCapture={(event) => {
        if (isGraphItemInteractionTarget(event.target)) paneClicks.current?.reset();
      }}
    >
      {/* In body, since a transformed or filtered ancestor would re-anchor its fixed position. */}
      {createPortal(
        <div ref={freeRegion} className="canvas-free-region" aria-hidden="true" />,
        document.body
      )}
      <CanvasViewControls
        canvasSession={canvasSession}
        onSetSwimlaneScopeId={onSetSwimlaneScopeId}
        onShowFreeform={onShowFreeform}
        onToggleTransformation={(transformation) => {
          setPlacementKind(null);
          interactions.reset();
          onToggleTransformation(transformation);
        }}
      />
      <ConnectionHighlightProvider controller={connectionHighlightController}>
        <ReactFlow<N2CanvasNode, N2CanvasEdge>
          nodes={renderedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => {
            flow.current = instance;
          }}
          onNodesChange={(changes) => {
            const geometry = changes.filter(({ type }) => type !== 'select');
            if (geometry.length > 0) interactions.applyNodeChanges(geometry);
            followSelectionChanges(selectionChanges('node', changes));
          }}
          onEdgesChange={(changes) =>
            followSelectionChanges(selectionChanges('relationship', changes))
          }
          onMoveStart={() => {
            beginViewportTransform();
            viewportAuthorship.onMoveStart();
          }}
          onMoveEnd={settleViewportTransform}
          onNodeClick={(event) => {
            const root = canvasWrap.current;
            const canvasRect = root?.getBoundingClientRect();
            const nodeRect = event.currentTarget.getBoundingClientRect();
            const inspectorPlacement = inspectorPlacementForBounds(
              {
                left: nodeRect.left,
                right: nodeRect.right,
                top: nodeRect.top,
                bottom: nodeRect.bottom
              },
              canvasRect
                ? {
                    left: canvasRect.left,
                    right: canvasRect.right,
                    top: canvasRect.top,
                    bottom: canvasRect.bottom
                  }
                : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
            );
            // React Flow has already reported this click's selection change; this only places
            // the Inspector beside the clicked node.
            onSelectionChange((current) =>
              current.inspectorPlacement === inspectorPlacement
                ? current
                : { ...current, inspectorPlacement }
            );
          }}
          onNodeMouseEnter={(_, node) => {
            if (connectionHighlightController.getActiveNodeId() === node.id) return;
            connectionHighlightController.activate(node.id, connectionHighlights.get(node.id));
          }}
          onNodeMouseLeave={(_, node) => {
            connectionHighlightController.clearIfActive(node.id);
          }}
          onEdgeClick={() => paneClicks.current?.reset()}
          onNodeDragStart={(_, __, draggedNodes) => interactions.startNodeDrag(draggedNodes)}
          onNodeDrag={(_, draggedNode, draggedNodes) =>
            interactions.updateNodeDrag(draggedNode, draggedNodes)
          }
          onPaneClick={interactions.handlePaneClick}
          onNodeDragStop={(_, draggedNode, draggedNodes) =>
            interactions.stopNodeDrag(draggedNode, draggedNodes)
          }
          onConnect={handleConnect}
          multiSelectionKeyCode={interactions.multiSelectionKeyCode}
          selectionKeyCode={interactions.selectionKeyCode}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          elevateNodesOnSelect={false}
          minZoom={canvasMinZoom(view)}
          maxZoom={CANVAS_MAX_ZOOM}
          defaultEdgeOptions={{ interactionWidth: 24 }}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.2}
            color="var(--color-canvas-dots)"
          />
          <StructuredViewBackdrop view={view} dropTarget={interactions.dropTarget} />
          {relationships.groupRegions ? (
            <GroupRegionLayer
              nodes={renderedNodes}
              graph={graph}
              bundles={relationships.bundles}
              focusGroupIds={relationships.focusGroupIds}
              focusBundleKeys={relationships.focusBundleKeys}
              onZoomTier={setZoomTier}
            />
          ) : null}
          <CanvasFraming
            focusRequest={focusRequest}
            onFocusSettled={onFocusSettled}
            selectedNodeId={selectedNodeId}
            canvasWrap={canvasWrap}
            freeRegion={freeRegion}
            hasPersonMoved={hasPersonMoved}
            minZoom={canvasMinZoom(view)}
            maxZoom={CANVAS_MAX_ZOOM}
            writeOwnViewport={writeOwnViewport}
          />
          <CanvasMiniMap visible={minimapVisible} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ConnectionHighlightProvider>
      <CanvasToolbar
        nodeKind={nodeKind}
        placementKind={placementKind}
        relationshipKind={relationshipKind}
        allowNodeCreation={interactions.allowNodeCreation}
        {...filterControls}
        onActivateNodeTool={activateNodeTool}
        onSelectRelationshipKind={setRelationshipKind}
      />
      <CanvasHint
        deletingRelationshipIds={deletingRelationshipIds}
        interactionHint={interactions.hint}
        nodeKind={nodeKind}
        placementKind={placementKind}
        relationshipKind={relationshipKind}
        selectedRelationship={selectedRelationship}
      />
    </section>
  );
}
