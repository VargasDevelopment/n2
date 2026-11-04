import type { ProjectedRelationship } from '@n2/contracts';

/** A removed relationship as a domain sentence, read through its named endpoint roles. */
export function RemovedRelationship({
  relationship,
  references
}: {
  relationship: ProjectedRelationship;
  /** Card references by id; a card that is gone reads as "A card". */
  references: ReadonlyMap<string, string>;
}) {
  const reference = (nodeId: string) => <strong>{references.get(nodeId) ?? 'A card'}</strong>;
  return relationship.kind === 'member_of' ? (
    <>
      {reference(relationship.memberId)} is no longer part of {reference(relationship.groupId)}.
    </>
  ) : (
    <>
      {reference(relationship.dependentId)} no longer depends on{' '}
      {reference(relationship.dependencyId)}.
    </>
  );
}
