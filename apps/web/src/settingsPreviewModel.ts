import type { HandleOrientation, ProjectedWorkNode } from '@n2/contracts';
import { toCanvasEdges } from './canvasEdges.js';
import { N2_NODE_HEIGHT, N2_NODE_WIDTH } from './nodeGeometry.js';
import { relationshipNodeHandles } from './relationshipHandles.js';
import type { N2CanvasEdge } from './components/N2Edge.js';
import type { N2NodeActions, StandardCanvasNode } from './components/N2Node.js';

const timestamp = '2026-08-29T00:00:00.000Z';

const previewNode = (
  id: string,
  reference: string,
  title: string,
  kind: 'task' | 'group',
  progress: number
): ProjectedWorkNode => ({
  id,
  reference,
  title,
  description: '',
  kind,
  requestedStatus: 'in_progress',
  effectiveStatus: 'in_progress',
  progress,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: timestamp,
  updatedAt: timestamp
});

const task = previewNode('settings-preview-task', 'DEMO-1', 'Shape the interface', 'task', 0.6);
const group = previewNode('settings-preview-group', 'DEMO-2', 'Settings preview', 'group', 0.4);

const inertActions: N2NodeActions = {
  cycleStatus: () => undefined,
  deleteNode: () => undefined,
  rename: () => Promise.resolve(null),
  toggleNoteFold: () => undefined,
  touchNote: () => undefined
};

export const settingsPreviewNodes = (
  handleOrientation: HandleOrientation
): StandardCanvasNode[] => [
  {
    id: task.id,
    type: 'n2',
    position: { x: 320, y: 174 },
    draggable: false,
    focusable: false,
    selected: false,
    width: N2_NODE_WIDTH,
    height: N2_NODE_HEIGHT,
    initialWidth: N2_NODE_WIDTH,
    initialHeight: N2_NODE_HEIGHT,
    measured: { width: N2_NODE_WIDTH, height: N2_NODE_HEIGHT },
    handles: relationshipNodeHandles(handleOrientation),
    data: { actions: inertActions, handleOrientation, node: task, noteFold: 'slot' }
  },
  {
    id: group.id,
    type: 'n2',
    position: { x: 26, y: 40 },
    draggable: false,
    focusable: false,
    selected: false,
    width: N2_NODE_WIDTH,
    height: N2_NODE_HEIGHT,
    initialWidth: N2_NODE_WIDTH,
    initialHeight: N2_NODE_HEIGHT,
    measured: { width: N2_NODE_WIDTH, height: N2_NODE_HEIGHT },
    handles: relationshipNodeHandles(handleOrientation),
    data: { actions: inertActions, handleOrientation, node: group, noteFold: 'slot' }
  }
];

// Built by the canvas's own edge mapper, so markers and labels match the real canvas exactly.
export const settingsPreviewEdges = (): N2CanvasEdge[] =>
  toCanvasEdges(
    {
      nodes: [task, group],
      relationships: [
        {
          id: 'settings-preview-member-of',
          kind: 'member_of',
          memberId: task.id,
          groupId: group.id,
          createdAt: timestamp,
          isBlocking: false
        }
      ]
    },
    new Set()
  );
