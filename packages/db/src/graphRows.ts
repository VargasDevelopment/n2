import type { GraphNode, GraphRelationship } from '@n2/contracts';
import { toPlanningPlacement } from './planningPersistence.js';
import type { edges, nodes } from './schema.js';

export const toGraphNode = (row: typeof nodes.$inferSelect): GraphNode => {
  const identity = {
    id: row.id,
    reference: row.reference,
    title: row.title,
    position: { x: row.positionX, y: row.positionY },
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
  if (row.kind === 'note') {
    if (row.content === null) throw new Error(`Note ${row.id} is missing its content.`);
    if (toPlanningPlacement(row) !== null) {
      throw new Error(`Note ${row.id} cannot have a Planning Placement.`);
    }
    return { ...identity, kind: row.kind, content: row.content };
  }
  if (!row.requestedStatus) {
    throw new Error(`Work node ${row.id} is missing its requested status.`);
  }
  if (row.description === null) {
    throw new Error(`Work node ${row.id} is missing its description.`);
  }
  const planningPlacement = toPlanningPlacement(row);
  return {
    ...identity,
    kind: row.kind,
    description: row.description,
    requestedStatus: row.requestedStatus,
    ...(planningPlacement ? { planningPlacement } : {})
  };
};

export const toGraphRelationship = (row: typeof edges.$inferSelect): GraphRelationship =>
  row.kind === 'member_of'
    ? {
        id: row.id,
        kind: row.kind,
        memberId: row.source,
        groupId: row.target,
        createdAt: row.createdAt
      }
    : {
        id: row.id,
        kind: row.kind,
        dependentId: row.source,
        dependencyId: row.target,
        createdAt: row.createdAt
      };
