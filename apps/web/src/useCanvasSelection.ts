import { useState, type Dispatch, type SetStateAction } from 'react';
import type { CanvasGraph } from './canvasGraph.js';
import type { CanvasView } from './canvasView.js';
import {
  selectionPresentInGraph,
  selectionSubject,
  type GraphSelection
} from './graphInteraction.js';

/** Reconciles selection during render so a hidden item cannot survive into the next canvas commit. */
export const useCanvasSelection = (
  canvasView: CanvasView | null,
  selection: GraphSelection,
  setSelection: Dispatch<SetStateAction<GraphSelection>>
) => {
  const visibleGraph = canvasView?.graph ?? null;
  const [selectionGraph, setSelectionGraph] = useState<CanvasGraph | null>(null);

  if (visibleGraph !== selectionGraph) {
    setSelectionGraph(visibleGraph);
    if (visibleGraph) {
      setSelection((current) => selectionPresentInGraph(current, visibleGraph));
    }
  }

  const subject = selectionSubject(selection);
  const selectedNode =
    subject?.kind === 'node'
      ? (visibleGraph?.nodes.find(({ id }) => id === subject.nodeId) ?? null)
      : null;

  return { visibleGraph, selectedNode };
};
