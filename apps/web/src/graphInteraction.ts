import type {
  CreateRelationshipInput,
  NodeKind,
  NodeStatus,
  ProjectedNode,
  ProjectedProject,
  RelationshipKind
} from '@n2/contracts';
import { isWorkNode, relationshipEndpointIds } from '@n2/contracts';
import type { CanvasGraph } from './canvasGraph.js';

const statusCycle: NodeStatus[] = ['ready', 'in_progress', 'done', 'blocked'];

export const nextStatus = (status: NodeStatus): NodeStatus => {
  const index = statusCycle.indexOf(status);
  return statusCycle[(index + 1) % statusCycle.length]!;
};

/** Where a key press landed: on a control, in a text field, and whether the canvas owns it. */
export type KeyTarget = { interactive: boolean; editing: boolean; inCanvas: boolean };

/**
 * Escape clears the selection from anywhere but a text field. Delete only ever acts from the canvas
 * itself, so a press meant for the Activity sheet, the Inspector or a dialog never deletes.
 */
export const canvasKeyboardAction = (
  key: string,
  repeat: boolean,
  target: KeyTarget
): 'clear_selection' | 'delete_selection' | null => {
  if (repeat) return null;
  if (key === 'Escape') return target.editing ? null : 'clear_selection';
  if (key === 'Delete' || key === 'Backspace') {
    return target.inCanvas && !target.interactive ? 'delete_selection' : null;
  }
  return null;
};

export const placementKeyboardAction = (
  key: string,
  repeat: boolean,
  editingTarget: boolean,
  placementActive: boolean
): 'cancel_placement' | null =>
  placementActive && key === 'Escape' && !repeat && !editingTarget ? 'cancel_placement' : null;

export type NodeDeletion = {
  nodes: readonly ProjectedNode[];
  title: string;
  confirmLabel: string;
  consequences: readonly string[];
};

const kindNouns = {
  task: ['task', 'tasks'],
  group: ['group', 'groups'],
  note: ['note', 'notes']
} satisfies Record<NodeKind, readonly [string, string]>;

const plural = (count: number, noun: string): string => `${noun}${count === 1 ? '' : 's'}`;

/**
 * Describes deleting a selection as the supplied projection would apply it, or null when none of
 * its nodes remain. Relationships go when selected or when they touch a deleted node, and each is
 * counted once.
 */
export const nodeDeletion = (
  project: ProjectedProject,
  { nodeIds, relationshipIds }: CanvasSelection
): NodeDeletion | null => {
  const requested = new Set(nodeIds);
  const nodes = project.nodes.filter(({ id }) => requested.has(id));
  const [first] = nodes;
  if (!first) return null;
  const deleted = new Set(nodes.map(({ id }) => id));
  const removedRelationships = project.relationships.filter((relationship) => {
    const { subjectId, objectId } = relationshipEndpointIds(relationship);
    return (
      relationshipIds.includes(relationship.id) || deleted.has(subjectId) || deleted.has(objectId)
    );
  }).length;
  const groupsKeepingMembers = new Set(
    project.relationships.flatMap((relationship) =>
      relationship.kind === 'member_of' &&
      deleted.has(relationship.groupId) &&
      !deleted.has(relationship.memberId)
        ? [relationship.groupId]
        : []
    )
  ).size;
  const [singular, pluralNoun] = kindNouns[first.kind];
  const noun =
    nodes.length === 1
      ? singular
      : `${nodes.length} ${nodes.every(({ kind }) => kind === first.kind) ? pluralNoun : 'items'}`;

  return {
    nodes,
    title: `Delete ${noun}?`,
    confirmLabel: `Delete ${noun}`,
    consequences: [
      ...(removedRelationships > 0
        ? [
            `${removedRelationships} ${plural(removedRelationships, 'relationship')} will also be removed.`
          ]
        : []),
      ...(groupsKeepingMembers > 0
        ? [`Members of the deleted ${plural(groupsKeepingMembers, 'group')} stay in the project.`]
        : [])
    ]
  };
};

export type InspectorPlacement = 'left' | 'right' | 'top' | 'bottom';

/** What is selected on the canvas, each list in the order its items were selected. */
export type CanvasSelection = { nodeIds: readonly string[]; relationshipIds: readonly string[] };

/**
 * The one selection store. React Flow's selected flags, Escape and Delete, and the Inspector all
 * derive from it; React Flow's selection changes reach it only through applySelectionChanges.
 */
export type GraphSelection = CanvasSelection & {
  /** Where the Inspector opens for a selected node: presentation, not selection. */
  inspectorPlacement: InspectorPlacement;
};

export const noSelection: GraphSelection = {
  nodeIds: [],
  relationshipIds: [],
  inspectorPlacement: 'right'
};

export const nodeSelection = (
  nodeId: string,
  inspectorPlacement: InspectorPlacement = 'right'
): GraphSelection => ({ nodeIds: [nodeId], relationshipIds: [], inspectorPlacement });

export const relationshipSelection = (relationshipId: string): GraphSelection => ({
  ...noSelection,
  relationshipIds: [relationshipId]
});

export const hasSelection = ({ nodeIds, relationshipIds }: CanvasSelection): boolean =>
  nodeIds.length > 0 || relationshipIds.length > 0;

export type SelectionChange = { item: 'node' | 'relationship'; id: string; selected: boolean };

/** Applies item-level selection changes, keeping the identical selection when nothing changes. */
export const applySelectionChanges = (
  selection: GraphSelection,
  changes: readonly SelectionChange[]
): GraphSelection => {
  let { nodeIds, relationshipIds } = selection;
  for (const { item, id, selected } of changes) {
    const ids = item === 'node' ? nodeIds : relationshipIds;
    if (ids.includes(id) === selected) continue;
    const next = selected ? [...ids, id] : ids.filter((selectedId) => selectedId !== id);
    if (item === 'node') nodeIds = next;
    else relationshipIds = next;
  }
  return nodeIds === selection.nodeIds && relationshipIds === selection.relationshipIds
    ? selection
    : { ...selection, nodeIds, relationshipIds };
};

/** The Inspector's subject: the selected item when exactly one is selected, otherwise none. */
export type SelectionSubject =
  { kind: 'node'; nodeId: string } | { kind: 'relationship'; relationshipId: string };

export const selectionSubject = ({
  nodeIds,
  relationshipIds
}: CanvasSelection): SelectionSubject | null => {
  if (nodeIds.length + relationshipIds.length !== 1) return null;
  const [nodeId] = nodeIds;
  const [relationshipId] = relationshipIds;
  if (nodeId !== undefined) return { kind: 'node', nodeId };
  return relationshipId === undefined ? null : { kind: 'relationship', relationshipId };
};

export const selectionPresentInGraph = (
  selection: GraphSelection,
  graph: CanvasGraph
): GraphSelection =>
  applySelectionChanges(selection, [
    ...selection.nodeIds
      .filter((id) => !graph.nodes.some((node) => node.id === id))
      .map((id): SelectionChange => ({ item: 'node', id, selected: false })),
    ...selection.relationshipIds
      .filter((id) => !graph.relationships.some((relationship) => relationship.id === id))
      .map((id): SelectionChange => ({ item: 'relationship', id, selected: false }))
  ]);

type PaneClickActions = {
  createNode: () => void;
  dismissSelection: () => void;
  restoreSelection: () => void;
};

export type PaneClickCoordinator = {
  handle: (detail: number, actions: PaneClickActions) => void;
  commitPlacement: (actions: { dismissSelection: () => void; place: () => void }) => void;
  reset: () => void;
  dispose: () => void;
};

export const createPaneClickCoordinator = (): PaneClickCoordinator => {
  let restoreDismissedSelection: (() => void) | null = null;
  let suppressNextDoubleClick = false;
  let disposed = false;

  const clearDoubleClickSuppression = (): void => {
    suppressNextDoubleClick = false;
  };

  const clearDismissedSelection = (): void => {
    restoreDismissedSelection = null;
  };

  return {
    handle(detail, { createNode, dismissSelection, restoreSelection }) {
      if (disposed) return;
      if (detail < 1) return;
      if (detail % 2 === 0) {
        if (suppressNextDoubleClick) {
          clearDoubleClickSuppression();
          return;
        }
        restoreDismissedSelection?.();
        clearDismissedSelection();
        createNode();
        return;
      }

      clearDoubleClickSuppression();
      clearDismissedSelection();
      dismissSelection();
      restoreDismissedSelection = restoreSelection;
    },
    commitPlacement({ dismissSelection, place }) {
      if (disposed) return;
      clearDoubleClickSuppression();
      clearDismissedSelection();
      suppressNextDoubleClick = true;
      dismissSelection();
      place();
    },
    reset() {
      clearDoubleClickSuppression();
      clearDismissedSelection();
    },
    dispose() {
      disposed = true;
      clearDoubleClickSuppression();
      clearDismissedSelection();
    }
  };
};

/** The Inspector's width in pixels; CanvasOverlays.css draws it from the same value. */
export const INSPECTOR_WIDTH = 380;

export const inspectorPlacementForBounds = (
  nodeBounds: { left: number; right: number; top: number; bottom: number },
  canvasBounds: { left: number; right: number; top: number; bottom: number },
  inspectorWidth = INSPECTOR_WIDTH,
  gutter = 28
): InspectorPlacement => {
  const roomOnRight = canvasBounds.right - nodeBounds.right;
  const roomOnLeft = nodeBounds.left - canvasBounds.left;

  if (roomOnRight >= inspectorWidth + gutter) return 'right';
  if (roomOnLeft >= inspectorWidth + gutter) return 'left';

  const roomBelow = canvasBounds.bottom - nodeBounds.bottom;
  const roomAbove = nodeBounds.top - canvasBounds.top;
  return roomBelow >= roomAbove ? 'bottom' : 'top';
};

export function relationshipInput(
  graph: CanvasGraph,
  connectionStartId: string,
  connectionEndId: string,
  kind: RelationshipKind
): CreateRelationshipInput {
  const sourceNode = graph.nodes.find(({ id }) => id === connectionStartId);
  const targetNode = graph.nodes.find(({ id }) => id === connectionEndId);
  if (!sourceNode || !targetNode || !isWorkNode(sourceNode) || !isWorkNode(targetNode)) {
    throw new Error('Relationships can connect only tasks and groups; notes stand alone.');
  }
  if (kind === 'depends_on') {
    return { kind, dependentId: connectionStartId, dependencyId: connectionEndId };
  }

  const groupWasSource = sourceNode.kind === 'group' && targetNode.kind !== 'group';

  return {
    kind,
    memberId: groupWasSource ? connectionEndId : connectionStartId,
    groupId: groupWasSource ? connectionStartId : connectionEndId
  };
}
