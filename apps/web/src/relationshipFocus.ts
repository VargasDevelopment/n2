import type { ConnectionHighlightIndex } from './connectionHighlight.js';
import type { CanvasSelection } from './graphInteraction.js';

/**
 * What the selection reveals (ADR 0016). Hover reveals the same neighbourhood through the
 * connection highlight, but only while the pointer stays; the selection keeps it, so a quiet
 * relationship can be read and clicked.
 */
export type RelationshipFocus = {
  /** The selected relationships, and every relationship the hover highlight shows for a selected card. */
  relationshipIds: ReadonlySet<string>;
  /** The selected cards and every Group they are part of, directly or through other Groups. */
  groupIds: ReadonlySet<string>;
};

export const relationshipFocus = (
  selection: CanvasSelection,
  highlights: ConnectionHighlightIndex
): RelationshipFocus => {
  const relationshipIds = new Set(selection.relationshipIds);
  const groupIds = new Set(selection.nodeIds);
  for (const nodeId of selection.nodeIds) {
    const highlight = highlights.get(nodeId);
    for (const id of highlight.relationshipIds) relationshipIds.add(id);
    for (const id of highlight.ancestorGroupIds) groupIds.add(id);
  }
  return { relationshipIds, groupIds };
};
