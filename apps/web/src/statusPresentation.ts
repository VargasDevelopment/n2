import {
  isWorkNode,
  NODE_STATUSES,
  type NodeStatus,
  type ProjectedNode,
  type ProjectedWorkNode
} from '@n2/contracts';

export const nodeStatusLabels = {
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done'
} satisfies Record<NodeStatus, string>;

export const nodeStatusOptions = NODE_STATUSES.map((status) => ({
  status,
  label: nodeStatusLabels[status]
}));

const nodeStatusColors = {
  ready: 'var(--color-status-ready)',
  in_progress: 'var(--color-status-in-progress)',
  blocked: 'var(--color-status-blocked)',
  done: 'var(--color-status-done)'
} satisfies Record<NodeStatus, string>;

/** The minimap fill for a canvas item, so every minimap repeats the status color of the cards. */
export const canvasItemMiniMapColor = (item: ProjectedNode): string =>
  isWorkNode(item) ? nodeStatusColors[item.effectiveStatus] : 'var(--color-note)';

/**
 * The related work that causes a node's Blocked status. A requested Blocked status takes
 * precedence in the projection, so then no relationship is the cause, even if one is blocked.
 */
export const relationshipBlockers = (node: ProjectedWorkNode): readonly string[] =>
  node.requestedStatus === 'blocked' ? [] : node.blockedBy;
