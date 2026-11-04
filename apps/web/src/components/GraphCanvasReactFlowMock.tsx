import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react';
import { useConnectionHighlightController } from '../connectionHighlightContext.js';

type MockCanvasNode = {
  className?: string;
  data?: {
    handleOrientation?: string;
    node?: {
      planningPlacement?: { kind?: string };
    };
    presentation?: {
      placementLabel?: string;
    };
  };
  draggable?: boolean;
  focusable?: boolean;
  dragging?: boolean;
  height?: number;
  handles?: readonly {
    id?: string | null;
    position: string;
    type: string;
  }[];
  id: string;
  position: { x: number; y: number };
  selected?: boolean;
  type?: string;
  width?: number;
};

type MockSelectChange = { id: string; selected: boolean; type: 'select' };

type MockNodeChange =
  | MockSelectChange
  | {
      dragging: boolean;
      id: string;
      position: { x: number; y: number };
      type: 'position';
    };

type MockCanvasEdge = {
  data?: { lane?: number };
  id: string;
  markerEnd?: { color?: string; type?: string };
  selected?: boolean;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
};

type MockReactFlowProps = {
  children?: ReactNode;
  edges: MockCanvasEdge[];
  nodes: MockCanvasNode[];
  onConnect?: (connection: {
    source: string | null;
    sourceHandle: string | null;
    target: string | null;
    targetHandle: string | null;
  }) => void;
  onEdgeClick?: (event: MouseEvent<HTMLButtonElement>, edge: MockCanvasEdge) => void;
  onEdgesChange?: (changes: MockSelectChange[]) => void;
  onInit?: (instance: {
    getViewport: () => { x: number; y: number; zoom: number };
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
    setViewport: () => Promise<boolean>;
  }) => void;
  onMoveEnd?: () => void;
  onMoveStart?: () => void;
  onNodeClick?: (event: MouseEvent<HTMLButtonElement>, node: MockCanvasNode) => void;
  onNodeDrag?: (event: unknown, node: MockCanvasNode, nodes: MockCanvasNode[]) => void;
  onNodeDragStart?: (event: unknown, node: MockCanvasNode, nodes: MockCanvasNode[]) => void;
  onNodeDragStop?: (event: unknown, node: MockCanvasNode, nodes: MockCanvasNode[]) => void;
  onNodeMouseEnter?: (event: MouseEvent<HTMLButtonElement>, node: MockCanvasNode) => void;
  onNodeMouseLeave?: (event: MouseEvent<HTMLButtonElement>, node: MockCanvasNode) => void;
  onNodesChange?: (changes: MockNodeChange[]) => void;
  onPaneClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const createGraphCanvasReactFlowMock = (
  recordRender: () => unknown,
  zoom: () => number = () => 1
) => ({
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  MiniMap: () => <div data-testid="mock-minimap" />,
  ReactFlow: ({
    children,
    edges,
    nodes,
    onConnect,
    onEdgeClick,
    onEdgesChange,
    onInit,
    onMoveEnd,
    onMoveStart,
    onNodeClick,
    onNodeDrag,
    onNodeDragStart,
    onNodeDragStop,
    onNodeMouseEnter,
    onNodeMouseLeave,
    onNodesChange,
    onPaneClick
  }: MockReactFlowProps) => {
    recordRender();
    // Mirrors React Flow's selection store: a plain selection replaces everything else, a
    // modifier toggles one item, and only real differences are reported as changes.
    const selectExactly = (nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>): void => {
      const changesFor = (
        items: readonly { id: string; selected?: boolean }[],
        ids: ReadonlySet<string>
      ) =>
        items
          .filter(({ id, selected }) => Boolean(selected) !== ids.has(id))
          .map(({ id }): MockSelectChange => ({ id, selected: ids.has(id), type: 'select' }));
      const nodeChanges = changesFor(nodes, nodeIds);
      const edgeChanges = changesFor(edges, edgeIds);
      if (nodeChanges.length > 0) onNodesChange?.(nodeChanges);
      if (edgeChanges.length > 0) onEdgesChange?.(edgeChanges);
    };
    const connectionHighlightController = useConnectionHighlightController();
    const activeDragNodeIds = useRef<string[]>([]);
    const initialized = useRef(false);
    const [paneResetActive, setPaneResetActive] = useState(false);
    useEffect(() => {
      if (initialized.current || !onInit) return;
      initialized.current = true;
      onInit({
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        screenToFlowPosition: (position) => position,
        setViewport: () => Promise.resolve(true)
      });
    }, [onInit]);
    useLayoutEffect(() => {
      if (paneResetActive && edges.some(({ selected }) => selected)) {
        setPaneResetActive(false);
      }
    }, [edges, paneResetActive, setPaneResetActive]);

    return (
      <div>
        <button type="button" onPointerDown={onMoveStart}>
          Mock start viewport movement
        </button>
        <button type="button" onPointerUp={onMoveEnd}>
          Mock end viewport movement
        </button>
        <button
          type="button"
          onClick={() => {
            const [source, target] = nodes;
            if (!source || !target) return;
            onConnect?.({
              source: source.id,
              sourceHandle: null,
              target: target.id,
              targetHandle: null
            });
          }}
        >
          Mock connect first two nodes
        </button>
        <button
          type="button"
          onClick={() => {
            // A marquee first clears the selection, then selects every node it encloses along
            // with their relationships.
            selectExactly(new Set(), new Set());
            onNodesChange?.(nodes.map(({ id }) => ({ id, selected: true, type: 'select' })));
            onEdgesChange?.(edges.map(({ id }) => ({ id, selected: true, type: 'select' })));
          }}
        >
          Mock select all nodes
        </button>
        <button
          type="button"
          onPointerDown={(event) => {
            const cohort = nodes.filter(({ selected }) => selected);
            const primary = cohort[0];
            if (!primary) return;
            activeDragNodeIds.current = cohort.map(({ id }) => id);
            onNodeDragStart?.(event, primary, cohort);
          }}
        >
          Mock start selected nodes
        </button>
        <button
          type="button"
          onPointerDown={(event) => {
            const cohort = nodes.filter(({ selected }) => selected);
            const primary = cohort[0];
            if (!primary) return;
            activeDragNodeIds.current = cohort.map(({ id }) => id);
            onNodeDragStart?.(event, primary, cohort);
            const movedCohort = cohort.map((draggedNode) => ({
              ...draggedNode,
              dragging: true,
              position: {
                x: draggedNode.position.x + 120,
                y: draggedNode.position.y + 80
              }
            }));
            onNodesChange?.(
              movedCohort.map(({ id, position }) => ({
                id,
                position,
                dragging: true,
                type: 'position' as const
              }))
            );
            onNodeDrag?.(event, movedCohort[0]!, movedCohort);
          }}
        >
          Mock move selected nodes
        </button>
        <button
          type="button"
          onPointerUp={(event) => {
            const cohort = activeDragNodeIds.current
              .map((id) => nodes.find((node) => node.id === id))
              .filter((draggedNode): draggedNode is MockCanvasNode => draggedNode !== undefined)
              .map((draggedNode) => ({ ...draggedNode, dragging: false }));
            const primary = cohort[0];
            if (!primary) return;
            onNodesChange?.(
              cohort.map(({ id, position }) => ({
                id,
                position,
                dragging: false,
                type: 'position' as const
              }))
            );
            onNodeDragStop?.(event, primary, cohort);
            activeDragNodeIds.current = [];
          }}
        >
          Mock stop selected nodes
        </button>
        <button
          type="button"
          onClick={(event) => {
            const primary = nodes[0];
            if (!primary || primary.draggable === false) return;
            const moved = {
              ...primary,
              position: { x: primary.position.x + 294, y: primary.position.y }
            };
            onNodeDragStart?.(event, primary, [primary]);
            onNodesChange?.([
              { id: moved.id, position: moved.position, dragging: true, type: 'position' }
            ]);
            onNodeDrag?.(event, moved, [moved]);
            onNodeDragStop?.(event, moved, [moved]);
          }}
        >
          Mock move first node to next Kanban column
        </button>
        <button
          type="button"
          onClick={() => {
            const primary = nodes[0];
            if (!primary) return;
            onNodesChange?.([
              {
                id: primary.id,
                position: { x: primary.position.x + 5, y: primary.position.y },
                dragging: false,
                type: 'position'
              }
            ]);
          }}
        >
          Mock nudge first node
        </button>
        <button
          type="button"
          onClick={(event) => {
            onPaneClick?.(event);
            onNodesChange?.(
              nodes
                .filter(({ selected }) => selected)
                .map(({ id }) => ({ id, selected: false, type: 'select' }))
            );
            setPaneResetActive(true);
          }}
        >
          Mock pane
        </button>
        {nodes.map((node, index) => (
          <div className={`react-flow__node ${node.className ?? ''}`} key={node.id}>
            <button
              ref={connectionHighlightController.createNodeRef(node.id)}
              type="button"
              data-testid={`mock-node-${node.id}`}
              data-network-node-id={node.id}
              data-node-height={node.height}
              data-node-handle-orientation={node.data?.handleOrientation}
              data-node-handles={node.handles
                ?.map(({ id, position, type }) => `${id}:${type}:${position}`)
                .join(',')}
              data-node-draggable={node.draggable}
              data-node-focusable={node.focusable}
              data-node-type={node.type}
              data-node-placement-kind={node.data?.node?.planningPlacement?.kind}
              data-node-placement-label={node.data?.presentation?.placementLabel}
              data-node-x={node.position.x}
              data-node-y={node.position.y}
              data-selected={node.selected === true}
              data-node-width={node.width}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                  onNodesChange?.([{ id: node.id, selected: !node.selected, type: 'select' }]);
                } else if (!node.selected) {
                  selectExactly(new Set([node.id]), new Set());
                }
                onNodeClick?.(event, node);
              }}
              onMouseEnter={(event) => onNodeMouseEnter?.(event, node)}
              onMouseLeave={(event) => onNodeMouseLeave?.(event, node)}
            >
              {index === 0 ? 'Mock node' : `Mock node ${node.id}`}
            </button>
            {index === 0 ? (
              <>
                <button type="button" onClick={(event) => event.stopPropagation()}>
                  Mock appliance
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => onNodeDragStart?.(event, node, [node])}
                >
                  Mock drag
                </button>
              </>
            ) : null}
          </div>
        ))}
        {edges.map((edge) => (
          <button
            ref={connectionHighlightController.createRelationshipRef(edge.id)}
            type="button"
            key={edge.id}
            className="react-flow__edge"
            data-testid={`mock-edge-${edge.id}`}
            data-marker-type={edge.markerEnd?.type}
            data-marker-color={edge.markerEnd?.color}
            data-edge-lane={edge.data?.lane}
            data-network-relationship-id={edge.id}
            data-selected={paneResetActive ? false : edge.selected}
            data-source={edge.source}
            data-source-handle={edge.sourceHandle}
            data-target={edge.target}
            data-target-handle={edge.targetHandle}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey) {
                onEdgesChange?.([{ id: edge.id, selected: !edge.selected, type: 'select' }]);
              } else {
                selectExactly(new Set(), new Set([edge.id]));
              }
              onEdgeClick?.(event, edge);
            }}
          >
            Mock edge {edge.id}
          </button>
        ))}
        {children}
      </div>
    );
  },
  ViewportPortal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  // The mock viewport never pans. Its zoom is 1, the detail tier, unless a test zooms out to the
  // overview.
  useStore: <T,>(selector: (state: { transform: [number, number, number] }) => T): T =>
    selector({ transform: [0, 0, zoom()] }),
  // The mock never measures nodes, so N2's first fit never runs and needs no instance.
  useNodesInitialized: () => false,
  useReactFlow: () => ({}),
  useNodesState: (initialNodes: MockCanvasNode[]) => {
    const [nodes, setNodes] = useState(initialNodes);
    const onNodesChange = (changes: MockNodeChange[]): void => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const change = changes.find(({ id }) => id === node.id);
          if (!change) return node;
          return change.type === 'select'
            ? { ...node, selected: change.selected }
            : {
                ...node,
                dragging: change.dragging,
                position: change.position
              };
        })
      );
    };
    return [nodes, setNodes, onNodesChange];
  }
});
