import { isWorkNode, type ProjectedNode } from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';
import { byAuthoritativePosition } from './structuredCanvasItems.js';

export type SwimlaneId =
  `group:${string}` | `scope:${string}` | `outside:${string}` | 'unscoped' | 'notes';

export type Swimlane = {
  id: SwimlaneId;
  kind: SwimlaneKind;
  label: string;
  count: number;
  groupId?: string;
  primaryNodeIds: readonly string[];
  referenceNodeIds: readonly string[];
};

export type SwimlaneKind = 'group' | 'scope' | 'outside' | 'unscoped' | 'notes';

export type SwimlaneModel = {
  scopeGroupId: string | null;
  lanes: readonly Swimlane[];
};

const groupNodes = (graph: CanvasGraph) =>
  graph.nodes.filter((node) => node.kind === 'group').sort(byAuthoritativePosition);

export const defaultLaneScopeId = (graph: CanvasGraph): string | null => {
  const groups = groupNodes(graph);
  const memberGroupIds = new Set(
    graph.relationships.flatMap((relationship) =>
      relationship.kind === 'member_of' ? [relationship.memberId] : []
    )
  );
  return groups.find(({ id }) => !memberGroupIds.has(id))?.id ?? groups[0]?.id ?? null;
};

export const resolveLaneScopeId = (
  graph: CanvasGraph,
  requestedScopeGroupId: string | null
): string | null => {
  if (
    requestedScopeGroupId &&
    graph.nodes.some(({ id, kind }) => id === requestedScopeGroupId && kind === 'group')
  ) {
    return requestedScopeGroupId;
  }
  return defaultLaneScopeId(graph);
};

const membershipParents = (graph: CanvasGraph): ReadonlyMap<string, readonly string[]> => {
  const parents = new Map<string, string[]>();
  for (const relationship of graph.relationships) {
    if (relationship.kind !== 'member_of') continue;
    const current = parents.get(relationship.memberId) ?? [];
    current.push(relationship.groupId);
    parents.set(relationship.memberId, current);
  }
  return parents;
};

const reachableGroups = (
  nodeId: string,
  parents: ReadonlyMap<string, readonly string[]>
): ReadonlySet<string> => {
  const reachable = new Set<string>();
  const pending = [...(parents.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const groupId = pending.pop();
    if (!groupId || reachable.has(groupId)) continue;
    reachable.add(groupId);
    pending.push(...(parents.get(groupId) ?? []));
  }
  return reachable;
};

const resolveUnscopedModel = (graph: CanvasGraph): SwimlaneModel => {
  const orderedNodes = [...graph.nodes].sort(byAuthoritativePosition);
  const workNodeIds = orderedNodes.filter(isWorkNode).map(({ id }) => id);
  const noteNodeIds = orderedNodes.filter((node) => !isWorkNode(node)).map(({ id }) => id);
  return {
    scopeGroupId: null,
    lanes: [
      {
        id: 'unscoped',
        kind: 'unscoped',
        label: 'Visible work',
        count: workNodeIds.length,
        primaryNodeIds: workNodeIds,
        referenceNodeIds: []
      },
      {
        id: 'notes',
        kind: 'notes',
        label: 'Notes',
        count: noteNodeIds.length,
        primaryNodeIds: noteNodeIds,
        referenceNodeIds: []
      }
    ]
  };
};

export const resolveSwimlaneModel = (
  graph: CanvasGraph,
  scopeGroupId: string | null
): SwimlaneModel => {
  if (scopeGroupId === null) return resolveUnscopedModel(graph);
  const scope = graph.nodes.find(
    (node): node is Extract<ProjectedNode, { kind: 'group' }> =>
      node.id === scopeGroupId && node.kind === 'group'
  );
  if (!scope) throw new Error(`Swimlane scope must be a visible Group: ${scopeGroupId}`);

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const laneGroups = graph.relationships
    .flatMap((relationship) =>
      relationship.kind === 'member_of' && relationship.groupId === scopeGroupId
        ? [nodeById.get(relationship.memberId)]
        : []
    )
    .filter((node): node is Extract<ProjectedNode, { kind: 'group' }> => node?.kind === 'group')
    .sort(byAuthoritativePosition);
  const parents = membershipParents(graph);
  const scopeLaneId = `scope:${scopeGroupId}` as const;
  const outsideLaneId = `outside:${scopeGroupId}` as const;
  const groupLaneIds = laneGroups.map(({ id }) => `group:${id}` as const);
  const primaryIdsByLane = new Map<SwimlaneId, string[]>();
  const referenceIdsByLane = new Map<SwimlaneId, string[]>();
  const addToLane = (
    collection: Map<SwimlaneId, string[]>,
    laneId: SwimlaneId,
    nodeId: string
  ): void => {
    const current = collection.get(laneId) ?? [];
    current.push(nodeId);
    collection.set(laneId, current);
  };

  for (const node of [...graph.nodes].sort(byAuthoritativePosition)) {
    if (!isWorkNode(node)) {
      addToLane(primaryIdsByLane, 'notes', node.id);
      continue;
    }
    const reachable = reachableGroups(node.id, parents);
    const laneIds = laneGroups.flatMap(({ id }, index) =>
      reachable.has(id) ? [groupLaneIds[index]!] : []
    );
    const primaryLaneId =
      laneIds[0] ??
      (node.id === scopeGroupId || reachable.has(scopeGroupId) ? scopeLaneId : outsideLaneId);
    addToLane(primaryIdsByLane, primaryLaneId, node.id);
    for (const laneId of laneIds.slice(1)) addToLane(referenceIdsByLane, laneId, node.id);
  }

  const laneWithContents = (
    lane: Omit<Swimlane, 'count' | 'primaryNodeIds' | 'referenceNodeIds'>
  ): Swimlane => {
    const primaryNodeIds = primaryIdsByLane.get(lane.id) ?? [];
    const referenceNodeIds = referenceIdsByLane.get(lane.id) ?? [];
    return {
      ...lane,
      count: primaryNodeIds.length + referenceNodeIds.length,
      primaryNodeIds,
      referenceNodeIds
    };
  };
  const lanes: Swimlane[] = [
    laneWithContents({
      id: scopeLaneId,
      kind: 'scope',
      label: scope.title,
      groupId: scope.id
    }),
    ...laneGroups.map((group, index): Swimlane =>
      laneWithContents({
        id: groupLaneIds[index]!,
        kind: 'group',
        label: group.title,
        groupId: group.id
      })
    ),
    laneWithContents({
      id: outsideLaneId,
      kind: 'outside',
      label: 'Outside scope'
    }),
    laneWithContents({ id: 'notes', kind: 'notes', label: 'Notes' })
  ];

  return { scopeGroupId, lanes };
};
