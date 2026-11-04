import type { NodeKind, ProjectedRelationship, RelationshipKind } from '@n2/contracts';
import { relationshipInstruction, relationshipLabel } from '../relationshipPresentation.js';

export function CanvasHint({
  deletingRelationshipIds,
  interactionHint,
  nodeKind,
  placementKind,
  relationshipKind,
  selectedRelationship
}: {
  deletingRelationshipIds: ReadonlySet<string>;
  interactionHint: string | null;
  nodeKind: NodeKind;
  placementKind: NodeKind | null;
  relationshipKind: RelationshipKind;
  selectedRelationship: ProjectedRelationship | undefined;
}) {
  let message = `Double-click to add a ${nodeKind}. ${relationshipInstruction(relationshipKind)}.`;
  if (placementKind) message = `Click the canvas to place a ${placementKind}. Escape cancels.`;
  if (interactionHint) message = interactionHint;
  if (selectedRelationship) {
    const label = relationshipLabel(selectedRelationship);
    message = deletingRelationshipIds.has(selectedRelationship.id)
      ? `Deleting ${label.toLowerCase()} relationship…`
      : `${label} selected. Press Delete or Backspace to remove it; Escape cancels.`;
  }

  return <p className="canvas-hint">{message}</p>;
}
