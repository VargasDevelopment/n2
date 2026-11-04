import { relationshipEndpointIds, type ProjectedRelationship } from '@n2/contracts';

export type ConnectionHighlight = {
  connectedNodeIds: ReadonlySet<string>;
  relationshipIds: ReadonlySet<string>;
};

/** A card's highlight, and every Group it is part of, directly or through other Groups. */
export type CardConnections = ConnectionHighlight & { ancestorGroupIds: ReadonlySet<string> };

export type ConnectionHighlightIndex = {
  get: (nodeId: string) => CardConnections;
};

type MutableConnectionHighlight = {
  connectedNodeIds: Set<string>;
  relationshipIds: Set<string>;
};

type MembershipParent = {
  groupId: string;
  relationshipId: string;
};

const highlightFor = (
  index: Map<string, MutableConnectionHighlight>,
  nodeId: string
): MutableConnectionHighlight => {
  const existing = index.get(nodeId);
  if (existing) return existing;
  const highlight = { connectedNodeIds: new Set<string>(), relationshipIds: new Set<string>() };
  index.set(nodeId, highlight);
  return highlight;
};

export const indexConnectionHighlights = (
  relationships: ProjectedRelationship[]
): ConnectionHighlightIndex => {
  const index = new Map<string, MutableConnectionHighlight>();
  const membershipParents = new Map<string, MembershipParent[]>();

  for (const relationship of relationships) {
    const { objectId, subjectId } = relationshipEndpointIds(relationship);
    const subjectHighlight = highlightFor(index, subjectId);
    subjectHighlight.connectedNodeIds.add(objectId);
    subjectHighlight.relationshipIds.add(relationship.id);

    const objectHighlight = highlightFor(index, objectId);
    objectHighlight.connectedNodeIds.add(subjectId);
    objectHighlight.relationshipIds.add(relationship.id);

    if (relationship.kind === 'member_of') {
      const parents = membershipParents.get(relationship.memberId);
      const parent = { groupId: relationship.groupId, relationshipId: relationship.id };
      if (parents) parents.push(parent);
      else membershipParents.set(relationship.memberId, [parent]);
    }
  }

  return {
    get: (nodeId) => {
      const direct = index.get(nodeId);
      const highlight = {
        connectedNodeIds: new Set(direct?.connectedNodeIds),
        relationshipIds: new Set(direct?.relationshipIds),
        ancestorGroupIds: new Set<string>()
      };
      const visited = new Set([nodeId]);
      const pending = [nodeId];
      while (pending.length > 0) {
        const currentId = pending.pop();
        if (!currentId) continue;
        for (const parent of membershipParents.get(currentId) ?? []) {
          if (parent.groupId !== nodeId) {
            highlight.connectedNodeIds.add(parent.groupId);
            highlight.ancestorGroupIds.add(parent.groupId);
          }
          highlight.relationshipIds.add(parent.relationshipId);
          if (visited.has(parent.groupId)) continue;
          visited.add(parent.groupId);
          pending.push(parent.groupId);
        }
      }
      return highlight;
    }
  };
};
