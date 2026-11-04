import { isWorkNode, type HandleOrientation, type NodeStatus } from '@n2/contracts';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';
import type { NodeChange } from '@xyflow/react';
import { toCanvasNodes } from './canvasNodes.js';
import { kanbanStatusAtX } from './canvasView.js';
import type { CanvasSession } from './canvasSession.js';
import type { N2CanvasNode } from './canvasNodes.js';
import type { N2NodeActions } from './components/N2Node.js';
import { N2_NODE_WIDTH } from './nodeGeometry.js';
import { nodeStatusLabels } from './statusPresentation.js';
import { useDragCohort } from './useDragCohort.js';

type PaneClickEvent = { clientX: number; clientY: number; detail: number };

export const useCanvasInteractionController = ({
  actions,
  canvasSession,
  handleOrientation,
  onFreeformPaneClick,
  onStructuredPaneClick,
  setNodes,
  onNodesChange
}: {
  actions: N2NodeActions;
  canvasSession: CanvasSession;
  handleOrientation: HandleOrientation;
  onFreeformPaneClick: (event: PaneClickEvent) => void;
  onStructuredPaneClick: () => void;
  setNodes: Dispatch<SetStateAction<N2CanvasNode[]>>;
  onNodesChange: (changes: NodeChange<N2CanvasNode>[]) => void;
}) => {
  const view = canvasSession.view;
  const latestView = useRef(view);
  const [dropTarget, setDropTarget] = useState<NodeStatus | null>(null);
  useLayoutEffect(() => {
    latestView.current = view;
  }, [view]);

  const dragCohort = useDragCohort({
    freeform:
      canvasSession.kind === 'freeform'
        ? { graph: view.graph, persist: canvasSession.onMoveNodes }
        : null,
    setNodes
  });

  const applyNodeChanges = useCallback(
    (changes: NodeChange<N2CanvasNode>[]): void => {
      if (view.capabilities.authoritativePositionWrites) {
        onNodesChange(changes);
        return;
      }
      const acceptedChanges = changes.filter(
        (change) => change.type !== 'position' || change.dragging === true
      );
      onNodesChange(acceptedChanges);
      if (acceptedChanges.length !== changes.length) {
        setNodes(toCanvasNodes(view, actions, handleOrientation));
      }
    },
    [actions, handleOrientation, onNodesChange, setNodes, view]
  );

  const startNodeDrag = useCallback(
    (draggedNodes: N2CanvasNode[]): void => dragCohort.start(draggedNodes),
    [dragCohort]
  );

  const updateNodeDrag = useCallback(
    (draggedNode: N2CanvasNode, draggedNodes: N2CanvasNode[]): void => {
      if (canvasSession.kind === 'freeform') {
        dragCohort.update(draggedNodes);
        return;
      }
      if (canvasSession.kind !== 'kanban') return;
      const item = draggedNode.data.node;
      setDropTarget(
        isWorkNode(item)
          ? kanbanStatusAtX(draggedNode.position.x + N2_NODE_WIDTH / 2, canvasSession.view.board)
          : null
      );
    },
    [canvasSession, dragCohort]
  );

  const stopNodeDrag = useCallback(
    (draggedNode: N2CanvasNode, draggedNodes: N2CanvasNode[]): void => {
      if (canvasSession.kind === 'freeform') {
        dragCohort.stop(draggedNodes);
        return;
      }
      if (canvasSession.kind !== 'kanban') {
        setNodes(toCanvasNodes(canvasSession.view, actions, handleOrientation));
        return;
      }
      setDropTarget(null);
      const renderedItem = draggedNode.data.node;
      const currentItem = latestView.current.graph.nodes.find(({ id }) => id === renderedItem.id);
      const currentWorkItem = currentItem && isWorkNode(currentItem) ? currentItem : null;
      const requestedStatus = currentWorkItem
        ? kanbanStatusAtX(draggedNode.position.x + N2_NODE_WIDTH / 2, canvasSession.view.board)
        : null;
      setNodes(toCanvasNodes(canvasSession.view, actions, handleOrientation));
      if (
        currentWorkItem !== null &&
        requestedStatus !== null &&
        requestedStatus !== currentWorkItem.requestedStatus
      ) {
        canvasSession.onSetRequestedStatus(currentWorkItem, requestedStatus);
      }
    },
    [actions, canvasSession, dragCohort, handleOrientation, setNodes]
  );

  const handlePaneClick = useCallback(
    (event: PaneClickEvent): void => {
      if (canvasSession.kind === 'freeform') onFreeformPaneClick(event);
      else if (event.detail === 1) onStructuredPaneClick();
    },
    [canvasSession.kind, onFreeformPaneClick, onStructuredPaneClick]
  );

  return {
    allowNodeCreation: view.capabilities.nodeCreation,
    applyNodeChanges,
    dropTarget,
    handlePaneClick,
    hint:
      canvasSession.kind === 'kanban'
        ? dropTarget
          ? `Set requested status to ${nodeStatusLabels[dropTarget]}. Effective status decides the final column.`
          : 'Drag work between columns to set requested status. Filters remain active.'
        : canvasSession.kind === 'roadmap'
          ? 'Planning Windows and Milestones follow the calendar. Filters remain active.'
          : canvasSession.kind === 'swimlane'
            ? 'Work is grouped by membership lanes. Filters remain active.'
            : null,
    multiSelectionKeyCode: view.capabilities.multiSelection ? ['Meta', 'Control'] : null,
    reconcile: dragCohort.reconcile,
    reset: dragCohort.reset,
    selectionKeyCode: view.capabilities.multiSelection ? ('Shift' as const) : null,
    startNodeDrag,
    stopNodeDrag,
    updateNodeDrag
  };
};
