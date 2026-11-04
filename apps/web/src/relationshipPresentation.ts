import {
  relationshipEndpointIds,
  type ProjectedRelationship,
  type RelationshipKind
} from '@n2/contracts';

const instructions: Record<RelationshipKind, string> = {
  member_of: 'Connect the member to the group',
  depends_on: 'Connect the dependent to the dependency'
};

export const relationshipInstruction = (kind: RelationshipKind): string => instructions[kind];

const edgeColors: Record<RelationshipKind, string> = {
  member_of: 'var(--color-relationship-member-of)',
  depends_on: 'var(--color-relationship-depends-on)'
};

export const relationshipColor = (relationship: ProjectedRelationship): string =>
  relationship.isBlocking ? 'var(--color-relationship-blocking)' : edgeColors[relationship.kind];

export const relationshipLabel = (relationship: ProjectedRelationship): string => {
  if (relationship.isBlocking) {
    return relationship.kind === 'depends_on' ? 'Blocked by' : 'Blocked part';
  }
  return relationship.kind === 'member_of' ? 'Part of' : 'Depends on';
};

export const relationshipAriaLabel = (
  relationship: ProjectedRelationship,
  titleByNodeId: ReadonlyMap<string, string>
): string => {
  const { objectId, subjectId } = relationshipEndpointIds(relationship);
  if (relationship.kind === 'member_of') {
    const member = titleByNodeId.get(subjectId) ?? subjectId;
    const group = titleByNodeId.get(objectId) ?? objectId;
    return relationship.isBlocking
      ? `${member} is a blocked part of ${group}`
      : `${member} is part of ${group}`;
  }

  const dependent = titleByNodeId.get(subjectId) ?? subjectId;
  const dependency = titleByNodeId.get(objectId) ?? objectId;
  return relationship.isBlocking
    ? `${dependent} is blocked by ${dependency}`
    : `${dependent} depends on ${dependency}`;
};
