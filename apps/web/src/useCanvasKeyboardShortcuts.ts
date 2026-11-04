import type { NodeKind } from '@n2/contracts';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react';
import type { CanvasGraph } from './canvasGraph.js';
import {
  canvasKeyboardAction,
  hasSelection,
  noSelection,
  placementKeyboardAction,
  selectionPresentInGraph,
  type CanvasSelection,
  type GraphSelection,
  type PaneClickCoordinator
} from './graphInteraction.js';

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="link"]'
    ) !== null
  );
};

const isEditingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest('input, textarea, select, [contenteditable="true"]') !== null;

// A key aimed at nothing in particular lands on the page itself rather than on an element.
const isPageTarget = (target: EventTarget | null): boolean =>
  !(target instanceof Element) || target === document.body || target === document.documentElement;

/**
 * Escape and Delete for the canvas, acting on the whole selection store: Escape clears all of it,
 * and Delete removes exactly what it holds, but only while the canvas owns the keyboard. Returns
 * the relationships whose deletion is still in
 * flight, which ignore repeated presses.
 */
export const useCanvasKeyboardShortcuts = ({
  canvas,
  enabled,
  graph,
  selection,
  placementActive,
  paneClicks,
  setPlacementKind,
  applyGraphSelection,
  onDeleteSelection,
  onDeleteRelationship
}: {
  canvas: RefObject<HTMLElement | null>;
  enabled: boolean;
  graph: CanvasGraph;
  selection: GraphSelection;
  placementActive: boolean;
  paneClicks: RefObject<PaneClickCoordinator | null>;
  setPlacementKind: Dispatch<SetStateAction<NodeKind | null>>;
  applyGraphSelection: (selection: SetStateAction<GraphSelection>) => void;
  onDeleteSelection: (selection: CanvasSelection) => void;
  onDeleteRelationship: (relationshipId: string) => Promise<void>;
}): ReadonlySet<string> => {
  const [deletingRelationshipIds, setDeletingRelationshipIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // Whether the latest press or focus landed in the canvas. A click on a panel's plain text leaves
  // focus on the page, so the page alone does not say the canvas is being worked in.
  const workingInCanvas = useRef(true);

  useEffect(() => {
    const follow = (event: Event): void => {
      workingInCanvas.current =
        event.target instanceof Node && canvas.current?.contains(event.target) === true;
    };
    window.addEventListener('pointerdown', follow, true);
    window.addEventListener('focusin', follow, true);
    return () => {
      window.removeEventListener('pointerdown', follow, true);
      window.removeEventListener('focusin', follow, true);
    };
  }, [canvas]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleCanvasKeyDown = (event: KeyboardEvent): void => {
      if (
        placementKeyboardAction(
          event.key,
          event.repeat,
          isEditingTarget(event.target),
          placementActive
        ) === 'cancel_placement'
      ) {
        event.preventDefault();
        paneClicks.current?.reset();
        setPlacementKind(null);
        return;
      }

      const { target } = event;
      const action = canvasKeyboardAction(event.key, event.repeat, {
        interactive: isInteractiveTarget(target),
        editing: isEditingTarget(target),
        inCanvas:
          (target instanceof Node && canvas.current?.contains(target) === true) ||
          (isPageTarget(target) && workingInCanvas.current)
      });
      if (!action) return;
      if (action === 'clear_selection') {
        paneClicks.current?.reset();
        if (!hasSelection(selection)) return;
        event.preventDefault();
        applyGraphSelection(noSelection);
        return;
      }

      const { nodeIds, relationshipIds } = selectionPresentInGraph(selection, graph);
      if (nodeIds.length > 0) {
        event.preventDefault();
        onDeleteSelection({ nodeIds, relationshipIds });
        return;
      }
      if (relationshipIds.length === 0) return;
      event.preventDefault();
      paneClicks.current?.reset();
      for (const relationshipId of relationshipIds) {
        if (deletingRelationshipIds.has(relationshipId)) continue;
        setDeletingRelationshipIds((current) => new Set(current).add(relationshipId));
        const finishDeletion = (): void => {
          setDeletingRelationshipIds((current) => {
            const next = new Set(current);
            next.delete(relationshipId);
            return next;
          });
        };
        void onDeleteRelationship(relationshipId).then(finishDeletion, finishDeletion);
      }
    };

    window.addEventListener('keydown', handleCanvasKeyDown);
    return () => window.removeEventListener('keydown', handleCanvasKeyDown);
  }, [
    applyGraphSelection,
    canvas,
    deletingRelationshipIds,
    enabled,
    graph,
    onDeleteRelationship,
    onDeleteSelection,
    paneClicks,
    placementActive,
    selection,
    setPlacementKind
  ]);

  return deletingRelationshipIds;
};
