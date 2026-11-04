import type {
  ProjectedNode,
  ProjectedProject,
  ProjectedWorkNode,
  WorkNodeKind
} from '@n2/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import overlayCss from './CanvasOverlays.css?raw';
import {
  canvasKeyboardAction,
  createPaneClickCoordinator,
  INSPECTOR_WIDTH,
  inspectorPlacementForBounds,
  nextStatus,
  nodeDeletion,
  placementKeyboardAction,
  applySelectionChanges,
  nodeSelection,
  noSelection,
  relationshipInput,
  relationshipSelection,
  selectionPresentInGraph,
  selectionSubject
} from './graphInteraction.js';

afterEach(() => vi.useRealTimers());

const now = '2026-08-21T12:00:00.000Z';
const node = (id: string, kind: WorkNodeKind): ProjectedWorkNode => ({
  id,
  reference: 'N2-1',
  title: id,
  description: '',
  kind,
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
});

const project: ProjectedProject = {
  id: 'project',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [node('task', 'task'), node('group', 'group')],
  relationships: [],
  warnings: [],
  latestSequence: 0
};

const annotation: ProjectedNode = {
  id: 'note',
  reference: 'N2-9',
  title: 'Context',
  content: '',
  kind: 'note',
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: now,
  updatedAt: now
};

describe('graph interactions', () => {
  it('cycles statuses from ready through in-progress, done, and blocked', () => {
    expect(nextStatus('ready')).toBe('in_progress');
    expect(nextStatus('in_progress')).toBe('done');
    expect(nextStatus('done')).toBe('blocked');
    expect(nextStatus('blocked')).toBe('ready');
  });

  it('gives every relationship explicit subject and object roles', () => {
    expect(relationshipInput(project, 'task', 'group', 'member_of')).toEqual({
      memberId: 'task',
      groupId: 'group',
      kind: 'member_of'
    });
    expect(relationshipInput(project, 'group', 'task', 'member_of')).toEqual({
      memberId: 'task',
      groupId: 'group',
      kind: 'member_of'
    });
    expect(relationshipInput(project, 'task', 'group', 'depends_on')).toEqual({
      dependentId: 'task',
      dependencyId: 'group',
      kind: 'depends_on'
    });
  });

  it('prevents notes from entering the relationship gesture', () => {
    const withNote = { ...project, nodes: [...project.nodes, annotation] };

    expect(() => relationshipInput(withNote, 'task', 'note', 'depends_on')).toThrowError(
      'Relationships can connect only tasks and groups; notes stand alone.'
    );
    expect(() => relationshipInput(withNote, 'note', 'group', 'member_of')).toThrowError(
      'Relationships can connect only tasks and groups; notes stand alone.'
    );
  });

  const nodesOnly = (...nodeIds: string[]) => ({ nodeIds, relationshipIds: [] });

  it('describes deleting one node from the supplied project projection', () => {
    const projectWithMembership: ProjectedProject = {
      ...project,
      relationships: [
        {
          id: 'membership',
          kind: 'member_of',
          memberId: 'task',
          groupId: 'group',
          createdAt: now,
          isBlocking: false
        }
      ]
    };

    expect(nodeDeletion(projectWithMembership, nodesOnly('group'))).toEqual({
      nodes: [projectWithMembership.nodes[1]],
      title: 'Delete group?',
      confirmLabel: 'Delete group',
      consequences: [
        '1 relationship will also be removed.',
        'Members of the deleted group stay in the project.'
      ]
    });
    expect(nodeDeletion(projectWithMembership, nodesOnly('missing'))).toBeNull();
  });

  it('describes a multi-node delete once, counting shared relationships a single time', () => {
    const projectWithEdges: ProjectedProject = {
      ...project,
      nodes: [...project.nodes, node('other', 'task'), annotation],
      relationships: [
        {
          id: 'membership',
          kind: 'member_of',
          memberId: 'task',
          groupId: 'group',
          createdAt: now,
          isBlocking: false
        },
        {
          id: 'dependency',
          kind: 'depends_on',
          dependentId: 'other',
          dependencyId: 'task',
          createdAt: now,
          isBlocking: false
        }
      ]
    };

    // Deleting the Group with its only member keeps nobody behind, and a vanished ID is skipped.
    const mixed = nodeDeletion(projectWithEdges, nodesOnly('group', 'task', 'note', 'gone'));
    expect(mixed?.nodes.map(({ id }) => id)).toEqual(['task', 'group', 'note']);
    expect(mixed?.title).toBe('Delete 3 items?');
    expect(mixed?.consequences).toEqual(['2 relationships will also be removed.']);

    expect(nodeDeletion(projectWithEdges, nodesOnly('task', 'other'))?.confirmLabel).toBe(
      'Delete 2 tasks'
    );
    // A relationship selected alongside the nodes goes too, even when it touches none of them.
    expect(
      nodeDeletion(projectWithEdges, { nodeIds: ['group'], relationshipIds: ['dependency'] })
        ?.consequences
    ).toEqual([
      '2 relationships will also be removed.',
      'Members of the deleted group stay in the project.'
    ]);
  });

  it('applies selection changes in order and keeps the identical selection when nothing changes', () => {
    const relationshipFirst = relationshipSelection('edge');
    const mixed = applySelectionChanges(relationshipFirst, [
      { item: 'node', id: 'task', selected: true },
      { item: 'relationship', id: 'second-edge', selected: true }
    ]);

    expect(mixed).toEqual({
      ...noSelection,
      nodeIds: ['task'],
      relationshipIds: ['edge', 'second-edge']
    });
    expect(applySelectionChanges(mixed, [{ item: 'node', id: 'task', selected: true }])).toBe(
      mixed
    );
    expect(
      applySelectionChanges(mixed, [{ item: 'relationship', id: 'edge', selected: false }])
    ).toEqual({ ...noSelection, nodeIds: ['task'], relationshipIds: ['second-edge'] });
  });

  it('derives an Inspector subject only from a single selected item', () => {
    expect(selectionSubject(nodeSelection('task'))).toEqual({ kind: 'node', nodeId: 'task' });
    expect(selectionSubject(relationshipSelection('edge'))).toEqual({
      kind: 'relationship',
      relationshipId: 'edge'
    });
    expect(selectionSubject({ nodeIds: ['task'], relationshipIds: ['edge'] })).toBeNull();
    expect(selectionSubject(noSelection)).toBeNull();
  });

  it('retains only selected items that remain in the latest project', () => {
    const selection = { ...nodeSelection('task', 'left'), relationshipIds: ['membership', 'gone'] };
    const projectWithRelationship: ProjectedProject = {
      ...project,
      relationships: [
        {
          id: 'membership',
          kind: 'member_of',
          memberId: 'task',
          groupId: 'group',
          createdAt: now,
          isBlocking: false
        }
      ]
    };
    const present = { ...selection, relationshipIds: ['membership'] };

    expect(selectionPresentInGraph(present, projectWithRelationship)).toBe(present);
    expect(selectionPresentInGraph(selection, { ...projectWithRelationship, nodes: [] })).toEqual({
      ...noSelection,
      inspectorPlacement: 'left',
      relationshipIds: ['membership']
    });
  });

  it('closes selection with Escape without stealing editor-local shortcuts', () => {
    const canvas = { interactive: false, editing: false, inCanvas: true };
    const control = { ...canvas, interactive: true };
    expect(canvasKeyboardAction('Escape', false, canvas)).toBe('clear_selection');
    expect(canvasKeyboardAction('Escape', false, control)).toBe('clear_selection');
    expect(canvasKeyboardAction('Escape', false, { ...control, editing: true })).toBeNull();
    expect(canvasKeyboardAction('Delete', false, canvas)).toBe('delete_selection');
    expect(canvasKeyboardAction('Delete', false, control)).toBeNull();
  });

  it('deletes only from the canvas, never from a panel or dialog beside it', () => {
    const beside = { interactive: false, editing: false, inCanvas: false };
    expect(canvasKeyboardAction('Backspace', false, beside)).toBeNull();
    expect(canvasKeyboardAction('Delete', false, beside)).toBeNull();
    expect(canvasKeyboardAction('Escape', false, beside)).toBe('clear_selection');
  });

  it('gives placement cancellation priority while preserving editor-local Escape', () => {
    expect(placementKeyboardAction('Escape', false, false, true)).toBe('cancel_placement');
    expect(placementKeyboardAction('Escape', false, true, true)).toBeNull();
    expect(placementKeyboardAction('Escape', false, false, false)).toBeNull();
  });

  it('places details in available space without covering the selected node', () => {
    const canvas = { left: 0, right: 1280, top: 0, bottom: 700 };
    expect(
      inspectorPlacementForBounds({ left: 900, right: 1130, top: 286, bottom: 426 }, canvas)
    ).toBe('left');
    expect(
      inspectorPlacementForBounds({ left: 100, right: 330, top: 286, bottom: 426 }, canvas)
    ).toBe('right');
    expect(
      inspectorPlacementForBounds(
        { left: 235, right: 465, top: 280, bottom: 420 },
        { left: 0, right: 700, top: 0, bottom: 700 }
      )
    ).toBe('bottom');
    expect(
      inspectorPlacementForBounds(
        { left: 235, right: 465, top: 520, bottom: 660 },
        { left: 0, right: 700, top: 0, bottom: 700 }
      )
    ).toBe('top');
  });

  it('chooses placement with the width the stylesheet draws', () => {
    expect(overlayCss).toContain(`--canvas-panel-width: ${INSPECTOR_WIDTH}px;`);
  });

  it('dismisses on the first click and restores only when it becomes a double-click', () => {
    const coordinator = createPaneClickCoordinator();
    const dismiss = vi.fn();
    const create = vi.fn();
    const restore = vi.fn();
    const actions = { createNode: create, dismissSelection: dismiss, restoreSelection: restore };

    coordinator.handle(1, actions);
    expect(dismiss).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();

    coordinator.handle(2, actions);
    expect(restore).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();

    coordinator.handle(3, actions);
    expect(create).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledTimes(2);

    coordinator.handle(4, actions);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);

    coordinator.handle(1, actions);
    expect(dismiss).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it('restores selection before creating from a double-click', () => {
    const coordinator = createPaneClickCoordinator();
    const selection = { current: 'selected-node' as string | null };
    const createNode = vi.fn(() => expect(selection.current).toBe('selected-node'));
    const actions = {
      createNode,
      dismissSelection: () => {
        selection.current = null;
      },
      restoreSelection: () => {
        selection.current = 'selected-node';
      }
    };

    coordinator.handle(1, actions);
    expect(selection.current).toBeNull();

    coordinator.handle(2, actions);

    expect(selection.current).toBe('selected-node');
    expect(createNode).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('commits explicit placement on the first click without double-creating', () => {
    const coordinator = createPaneClickCoordinator();
    const dismiss = vi.fn();
    const createFromDoubleClick = vi.fn();
    const place = vi.fn();

    coordinator.commitPlacement({ dismissSelection: dismiss, place });
    const actions = {
      createNode: createFromDoubleClick,
      dismissSelection: dismiss,
      restoreSelection: vi.fn()
    };
    coordinator.handle(2, actions);

    expect(place).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(createFromDoubleClick).not.toHaveBeenCalled();

    coordinator.handle(1, actions);
    coordinator.handle(2, actions);
    expect(createFromDoubleClick).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('resets stale restoration without disposing the reusable coordinator', () => {
    const coordinator = createPaneClickCoordinator();
    const firstDismiss = vi.fn();
    const staleRestore = vi.fn();
    const nextDismiss = vi.fn();

    coordinator.handle(1, {
      createNode: vi.fn(),
      dismissSelection: firstDismiss,
      restoreSelection: staleRestore
    });
    coordinator.reset();
    coordinator.handle(2, {
      createNode: vi.fn(),
      dismissSelection: vi.fn(),
      restoreSelection: vi.fn()
    });
    expect(firstDismiss).toHaveBeenCalledOnce();
    expect(staleRestore).not.toHaveBeenCalled();

    coordinator.handle(1, {
      createNode: vi.fn(),
      dismissSelection: nextDismiss,
      restoreSelection: vi.fn()
    });
    expect(nextDismiss).toHaveBeenCalledOnce();
    coordinator.dispose();
  });
});
