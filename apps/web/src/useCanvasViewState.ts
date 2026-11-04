import type { NodeStatus, ProjectedProject } from '@n2/contracts';
import { useCallback, useMemo, useState } from 'react';
import { filterCanvas, type CanvasFilters } from './canvasFilter.js';
import {
  resolveCanvasView,
  toggleCanvasTransformation,
  type CanvasTransformationId,
  type CanvasViewOptions
} from './canvasView.js';
import type { CanvasFilterControls } from './components/CanvasToolbar.js';
import { useNoteExpansion } from './noteFold.js';
import type { RoadmapRange } from './roadmapRange.js';

/** The view state a link from outside the canvas has to reset so its item shows. */
export type CanvasReveal = { clearFilters: boolean; resetRoadmapRange: boolean };

type CanvasProject = Pick<ProjectedProject, 'nodes' | 'relationships'>;
const noFilters: CanvasFilters = { hiddenStatuses: new Set(), textQuery: '' };

/**
 * The least view state to reset for a node to show: nothing, the filters, the Roadmap range, or
 * both. Each option is judged by resolving the view it would leave, so any new way a view hides
 * items is covered too.
 */
export const canvasReveal = (
  project: CanvasProject,
  nodeId: string,
  filters: CanvasFilters,
  transformations: ReadonlySet<CanvasTransformationId>,
  options: CanvasViewOptions
): CanvasReveal => {
  const shows = ({ clearFilters, resetRoadmapRange }: CanvasReveal): boolean =>
    resolveCanvasView(
      filterCanvas(project, clearFilters ? noFilters : filters),
      transformations,
      resetRoadmapRange ? { ...options, roadmapRange: null } : options
    ).graph.nodes.some(({ id }) => id === nodeId);
  const candidates: CanvasReveal[] = [
    { clearFilters: false, resetRoadmapRange: false },
    { clearFilters: true, resetRoadmapRange: false },
    { clearFilters: false, resetRoadmapRange: true }
  ];
  return candidates.find(shows) ?? { clearFilters: true, resetRoadmapRange: true };
};

const revealMessage = ({ clearFilters, resetRoadmapRange }: CanvasReveal, item: string) => {
  if (clearFilters && resetRoadmapRange) {
    return `Cleared the filters and the Roadmap range to show ${item}.`;
  }
  if (clearFilters) return `Cleared the filters to show ${item}.`;
  if (resetRoadmapRange) return `Reset the Roadmap range to show ${item}.`;
  return null;
};

/**
 * The Project canvas's view state: filters, transformations, the Roadmap range, lane scope and
 * expanded Notes.
 */
export const useCanvasViewState = (project: CanvasProject | undefined) => {
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<NodeStatus>>(() => new Set());
  const [textQuery, setTextQuery] = useState('');
  const [transformations, setTransformations] = useState<ReadonlySet<CanvasTransformationId>>(
    () => new Set()
  );
  const [roadmapRange, setRoadmapRange] = useState<RoadmapRange | null>(null);
  const [swimlaneScopeId, setSwimlaneScopeId] = useState<string | null>(null);
  // Fed the Project itself, not the filtered graph below, so filtering never folds a Note.
  const noteExpansion = useNoteExpansion(project?.nodes);

  const canvasGraph = useMemo(
    () => (project ? filterCanvas(project, { hiddenStatuses, textQuery }) : null),
    [hiddenStatuses, project, textQuery]
  );
  const canvasView = useMemo(
    () =>
      canvasGraph
        ? resolveCanvasView(canvasGraph, transformations, { roadmapRange, swimlaneScopeId })
        : null,
    [canvasGraph, transformations, roadmapRange, swimlaneScopeId]
  );

  const filterControls = useMemo<CanvasFilterControls>(
    () => ({
      hiddenStatuses,
      textQuery,
      onTextQueryChange: setTextQuery,
      onToggleStatus: (status) =>
        setHiddenStatuses((current) => {
          const next = new Set(current);
          if (next.has(status)) next.delete(status);
          else next.add(status);
          return next;
        })
    }),
    [hiddenStatuses, textQuery]
  );
  const toggleTransformation = useCallback((transformation: CanvasTransformationId): void => {
    setTransformations((current) => toggleCanvasTransformation(current, transformation));
  }, []);
  const showFreeform = useCallback((): void => setTransformations(new Set()), []);

  /**
   * Resets whatever view state hides a node, so a link to it never does nothing, and returns the
   * announcement of what was reset, or null when nothing was.
   */
  const reveal = useCallback(
    (nodeId: string): string | null => {
      const node = project?.nodes.find(({ id }) => id === nodeId);
      if (!project || !node) return null;
      const plan = canvasReveal(project, nodeId, { hiddenStatuses, textQuery }, transformations, {
        roadmapRange,
        swimlaneScopeId
      });
      if (plan.clearFilters) {
        setHiddenStatuses(new Set());
        setTextQuery('');
      }
      if (plan.resetRoadmapRange) setRoadmapRange(null);
      return revealMessage(plan, node.reference);
    },
    [hiddenStatuses, project, roadmapRange, swimlaneScopeId, textQuery, transformations]
  );

  return {
    canvasGraph,
    canvasView,
    filterControls,
    noteExpansion,
    roadmapRange,
    setRoadmapRange,
    setSwimlaneScopeId,
    toggleTransformation,
    showFreeform,
    reveal
  };
};
