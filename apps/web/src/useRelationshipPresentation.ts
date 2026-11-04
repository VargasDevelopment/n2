import { useMemo } from 'react';
import type { EdgePresentation } from './canvasEdges.js';
import type { CanvasGraph } from './canvasGraph.js';
import type { CanvasLayout } from './canvasView.js';
import type { ConnectionHighlightIndex } from './connectionHighlight.js';
import type { CanvasSelection } from './graphInteraction.js';
import { relationshipBundles, type RelationshipBundle } from './relationshipBundles.js';
import { relationshipFocus } from './relationshipFocus.js';

export type RelationshipPresentation = EdgePresentation & {
  /**
   * Whether a selection steps unrelated relationships back. Any selection does, even a card with no
   * relationships to reveal, so selecting it still quiets the lines that are not its own.
   */
  focusActive: boolean;
  /** Groups whose regions light up for the selection. */
  focusGroupIds: ReadonlySet<string>;
  /** Counted bundles for the zoomed-out canvas; empty where Group regions are not drawn. */
  bundles: readonly RelationshipBundle[];
  /** Bundles holding a relationship the selection reveals; the rest step back with the lines. */
  focusBundleKeys: ReadonlySet<string>;
};

/**
 * How the canvas draws relationships (ADR 0016). The freeform canvas draws Group regions and
 * bundles; the structured views already show membership as columns, lanes or rows, so they keep
 * Part of lines and only get the quiet labels, stubs and selection focus.
 */
export const useRelationshipPresentation = ({
  graph,
  layout,
  selection,
  connectionHighlights
}: {
  graph: CanvasGraph;
  layout: CanvasLayout;
  selection: CanvasSelection;
  connectionHighlights: ConnectionHighlightIndex;
}): RelationshipPresentation => {
  const groupRegions = layout === 'freeform';
  const { nodeIds, relationshipIds } = selection;
  const focus = useMemo(
    () => relationshipFocus({ nodeIds, relationshipIds }, connectionHighlights),
    [connectionHighlights, nodeIds, relationshipIds]
  );
  const bundles = useMemo(
    () =>
      groupRegions
        ? relationshipBundles(graph.relationships, new Set(graph.nodes.map(({ id }) => id)))
        : [],
    [graph.nodes, graph.relationships, groupRegions]
  );
  const focusActive = nodeIds.length > 0 || relationshipIds.length > 0;
  return useMemo(
    () => ({
      groupRegions,
      focusActive,
      focusedRelationshipIds: focus.relationshipIds,
      bundledRelationshipIds: new Set(bundles.flatMap((bundle) => bundle.relationshipIds)),
      focusGroupIds: focus.groupIds,
      bundles,
      focusBundleKeys: new Set(
        bundles.flatMap(({ key, relationshipIds }) =>
          relationshipIds.some((id) => focus.relationshipIds.has(id)) ? [key] : []
        )
      )
    }),
    [bundles, focus, focusActive, groupRegions]
  );
};
