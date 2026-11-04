import type { ProjectedProject } from '@n2/contracts';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nodeSelection,
  noSelection,
  relationshipSelection,
  type GraphSelection
} from '../graphInteraction.js';
import {
  RELATIONSHIP_OBJECT_HANDLE_ID,
  RELATIONSHIP_SUBJECT_HANDLE_ID
} from '../relationshipHandles.js';
import { VIEWPORT_TRANSFORM_SETTLE_MS } from '../useViewportCompositorHint.js';

const { reactFlowRenderSpy } = vi.hoisted(() => ({ reactFlowRenderSpy: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(reactFlowRenderSpy);
});

import {
  deferred,
  dependencyProject,
  edgeById,
  makeDependency,
  makeMembership,
  makeNode,
  makeNote,
  makeProject,
  node,
  nodeById,
  renderCanvas
} from './GraphCanvasTestHarness.js';

afterEach(() => {
  cleanup();
  reactFlowRenderSpy.mockClear();
  vi.useRealTimers();
});

describe('GraphCanvas interaction ordering', () => {
  it('defaults relationship creation to Part of while preserving an explicit choice across graph refreshes', () => {
    const task = makeNode('task');
    const group = makeNode('group', { kind: 'group' });
    const { callbacks, replaceProject } = renderCanvas({
      project: makeProject([task, group])
    });
    const partOf = screen.getByRole('button', { name: 'Part of' });
    const dependsOn = screen.getByRole('button', { name: 'Depends on' });
    const connect = screen.getByRole('button', { name: 'Mock connect first two nodes' });

    expect(partOf.getAttribute('aria-pressed')).toBe('true');
    expect(dependsOn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(connect);
    expect(callbacks.onCreateRelationship).toHaveBeenLastCalledWith({
      kind: 'member_of',
      memberId: task.id,
      groupId: group.id
    });

    fireEvent.click(dependsOn);
    replaceProject(makeProject([{ ...task, title: 'Refreshed task' }, group]));
    fireEvent.click(connect);

    expect(partOf.getAttribute('aria-pressed')).toBe('false');
    expect(dependsOn.getAttribute('aria-pressed')).toBe('true');
    expect(callbacks.onCreateRelationship).toHaveBeenLastCalledWith({
      kind: 'depends_on',
      dependentId: task.id,
      dependencyId: group.id
    });
  });

  it('dismisses a selected node immediately on the first pane click', () => {
    const { callbacks } = renderCanvas({
      selection: nodeSelection(node.id)
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mock pane' }), { detail: 1 });

    expect(callbacks.onSelectionChange).toHaveBeenCalledOnce();
    expect(callbacks.onSelectionChange).toHaveBeenCalledWith(noSelection);
  });

  it('restores before double-click creation and dismisses again on a third click', () => {
    const originalSelection: GraphSelection = nodeSelection(node.id);
    const { callbacks } = renderCanvas({ selection: originalSelection });
    const pane = screen.getByRole('button', { name: 'Mock pane' });
    const renderedNode = screen.getByRole('button', { name: 'Mock node' });

    fireEvent.click(pane, { detail: 1, clientX: 400, clientY: 300 });
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(noSelection);
    expect(renderedNode.getAttribute('data-selected')).toBe('false');

    fireEvent.click(pane, { detail: 2, clientX: 400, clientY: 300 });

    expect(callbacks.onSelectionChange).toHaveBeenNthCalledWith(2, originalSelection);
    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
    expect(callbacks.onCreateNode).toHaveBeenCalledWith('task', { x: 285, y: 230 });
    expect(renderedNode.getAttribute('data-selected')).toBe('true');

    fireEvent.click(pane, { detail: 3, clientX: 400, clientY: 300 });

    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(noSelection);
    expect(renderedNode.getAttribute('data-selected')).toBe('false');
    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
  });

  it('does not restore a node removed between the two pane clicks', () => {
    const originalSelection: GraphSelection = nodeSelection(node.id);
    const { callbacks, replaceProject } = renderCanvas({ selection: originalSelection });
    const pane = screen.getByRole('button', { name: 'Mock pane' });

    fireEvent.click(pane, { detail: 1, clientX: 400, clientY: 300 });
    replaceProject(makeProject([], []));
    fireEvent.click(pane, { detail: 2, clientX: 400, clientY: 300 });

    expect(callbacks.onSelectionChange).not.toHaveBeenCalledWith(originalSelection);
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(noSelection);
    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'appliance click',
      () => fireEvent.click(screen.getByRole('button', { name: 'Mock appliance' }))
    ],
    ['drag start', () => fireEvent.pointerDown(screen.getByRole('button', { name: 'Mock drag' }))]
  ])('does not restore a dismissed selection after a newer node %s', (_, interact) => {
    const { callbacks } = renderCanvas({
      selection: nodeSelection(node.id)
    });

    const pane = screen.getByRole('button', { name: 'Mock pane' });
    fireEvent.click(pane, { detail: 1 });
    interact();
    fireEvent.click(pane, { detail: 2 });

    expect(callbacks.onSelectionChange).toHaveBeenCalledWith(noSelection);
    expect(callbacks.onSelectionChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ nodeIds: [node.id] })
    );
  });

  it('renders membership from child group to parent group with a directional marker', () => {
    const childGroup = makeNode('child-group', { kind: 'group' });
    const parentGroup = makeNode('parent-group', {
      kind: 'group',
      position: { x: 300, y: 0 }
    });
    renderCanvas({
      project: makeProject(
        [childGroup, parentGroup],
        [makeMembership(childGroup.id, parentGroup.id)]
      )
    });

    const membership = edgeById('membership');
    expect(membership.getAttribute('data-marker-type')).toBe('arrowclosed');
    expect(membership.getAttribute('data-marker-color')).toBe(
      'var(--color-relationship-member-of)'
    );
    expect(membership.getAttribute('data-source')).toBe(childGroup.id);
    expect(membership.getAttribute('data-source-handle')).toBe(RELATIONSHIP_SUBJECT_HANDLE_ID);
    expect(membership.getAttribute('data-target')).toBe(parentGroup.id);
    expect(membership.getAttribute('data-target-handle')).toBe(RELATIONSHIP_OBJECT_HANDLE_ID);
  });

  it('renders dependency from dependent to dependency through the canonical handles', () => {
    renderCanvas({ project: dependencyProject() });

    const dependency = edgeById();
    expect(dependency.getAttribute('data-source')).toBe(node.id);
    expect(dependency.getAttribute('data-source-handle')).toBe(RELATIONSHIP_SUBJECT_HANDLE_ID);
    expect(dependency.getAttribute('data-target')).toBe('dependency');
    expect(dependency.getAttribute('data-target-handle')).toBe(RELATIONSHIP_OBJECT_HANDLE_ID);
  });

  it('provides the canonical node dimensions to React Flow', () => {
    renderCanvas();

    const renderedNode = screen.getByRole('button', { name: 'Mock node' });
    expect(renderedNode.getAttribute('data-node-width')).toBe('230');
    expect(renderedNode.getAttribute('data-node-height')).toBe('140');
  });

  it('uses the wider dynamic geometry for Notes', () => {
    renderCanvas({ project: makeProject([makeNote()]) });

    const renderedNode = screen.getByRole('button', { name: 'Mock node' });
    expect(renderedNode.getAttribute('data-node-width')).toBe('286');
    expect(renderedNode.hasAttribute('data-node-height')).toBe(false);
  });

  it('keeps the viewport compositor hint scoped to active movement and its settling window', () => {
    vi.useFakeTimers();
    renderCanvas();
    const canvas = screen.getByRole('region', { name: 'N2 graph canvas' });
    const start = screen.getByRole('button', { name: 'Mock start viewport movement' });
    const end = screen.getByRole('button', { name: 'Mock end viewport movement' });

    expect(canvas.hasAttribute('data-viewport-transforming')).toBe(false);

    fireEvent.pointerDown(start);
    expect(canvas.getAttribute('data-viewport-transforming')).toBe('true');

    fireEvent.pointerUp(end);
    act(() => {
      vi.advanceTimersByTime(VIEWPORT_TRANSFORM_SETTLE_MS - 1);
    });
    expect(canvas.getAttribute('data-viewport-transforming')).toBe('true');

    fireEvent.pointerDown(start);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(canvas.getAttribute('data-viewport-transforming')).toBe('true');

    fireEvent.pointerUp(end);
    act(() => {
      vi.advanceTimersByTime(VIEWPORT_TRANSFORM_SETTLE_MS);
    });
    expect(canvas.hasAttribute('data-viewport-transforming')).toBe(false);
  });

  it('keeps a multi-node drag together through refresh and persists every moved node', async () => {
    const first = makeNode('first', { position: { x: 10, y: 20 } });
    const second = makeNode('second', { position: { x: 310, y: 220 } });
    const cohortSave = deferred<ProjectedProject | null>();
    const onMoveNodes = vi.fn().mockReturnValue(cohortSave.promise);
    const { callbacks, replaceProject } = renderCanvas({
      project: makeProject([first, second]),
      callbacks: { onMoveNodes }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mock select all nodes' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mock move selected nodes' }));

    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('130');
    expect(nodeById(first.id).getAttribute('data-node-y')).toBe('100');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('430');
    expect(nodeById(second.id).getAttribute('data-node-y')).toBe('300');
    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');

    replaceProject(
      makeProject([
        { ...first, title: 'First refreshed' },
        { ...second, title: 'Second refreshed' }
      ])
    );

    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('130');
    expect(nodeById(first.id).getAttribute('data-node-y')).toBe('100');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('430');
    expect(nodeById(second.id).getAttribute('data-node-y')).toBe('300');
    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');

    fireEvent.pointerUp(screen.getByRole('button', { name: 'Mock stop selected nodes' }));

    replaceProject(makeProject([first, second]));

    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('130');
    expect(nodeById(first.id).getAttribute('data-node-y')).toBe('100');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('430');
    expect(nodeById(second.id).getAttribute('data-node-y')).toBe('300');
    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');

    expect(callbacks.onMoveNodes).toHaveBeenCalledOnce();
    const [persistedMoves] = vi.mocked(callbacks.onMoveNodes).mock.calls[0]!;
    expect(persistedMoves).toEqual([
      { nodeId: first.id, position: { x: 130, y: 100 } },
      { nodeId: second.id, position: { x: 430, y: 300 } }
    ]);

    await act(async () => {
      cohortSave.resolve(
        makeProject([
          { ...first, position: { x: 130, y: 100 }, version: 1 },
          { ...second, position: { x: 430, y: 300 }, version: 1 }
        ])
      );
      await cohortSave.promise;
    });

    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('130');
    expect(nodeById(first.id).getAttribute('data-node-y')).toBe('100');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('430');
    expect(nodeById(second.id).getAttribute('data-node-y')).toBe('300');
    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');
  });

  it('rolls an entire drag cohort back when its atomic move fails', async () => {
    const first = makeNode('first', { position: { x: 10, y: 20 } });
    const second = makeNode('second', { position: { x: 310, y: 220 } });
    const onMoveNodes = vi.fn().mockResolvedValue(makeProject([first, second]));
    const { callbacks } = renderCanvas({
      project: makeProject([first, second]),
      callbacks: { onMoveNodes }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mock select all nodes' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mock move selected nodes' }));
    await act(async () => {
      fireEvent.pointerUp(screen.getByRole('button', { name: 'Mock stop selected nodes' }));
      await Promise.resolve();
    });

    expect(callbacks.onMoveNodes).toHaveBeenCalledOnce();
    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('10');
    expect(nodeById(first.id).getAttribute('data-node-y')).toBe('20');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('310');
    expect(nodeById(second.id).getAttribute('data-node-y')).toBe('220');
  });

  it('does not persist an unchanged cohort and adopts positions refreshed during the gesture', () => {
    const first = makeNode('first', { position: { x: 10, y: 20 } });
    const second = makeNode('second', { position: { x: 310, y: 220 } });
    const { callbacks, replaceProject } = renderCanvas({ project: makeProject([first, second]) });

    fireEvent.click(screen.getByRole('button', { name: 'Mock select all nodes' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mock start selected nodes' }));
    replaceProject(
      makeProject([
        { ...first, position: { x: 50, y: 60 }, version: 1 },
        { ...second, position: { x: 350, y: 260 }, version: 1 }
      ])
    );

    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('10');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('310');

    fireEvent.pointerUp(screen.getByRole('button', { name: 'Mock stop selected nodes' }));

    expect(callbacks.onMoveNodes).not.toHaveBeenCalled();
    expect(nodeById(first.id).getAttribute('data-node-x')).toBe('50');
    expect(nodeById(first.id).getAttribute('data-node-y')).toBe('60');
    expect(nodeById(second.id).getAttribute('data-node-x')).toBe('350');
    expect(nodeById(second.id).getAttribute('data-node-y')).toBe('260');
    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');
  });

  it('reveals only the hovered node direct connection network and clears on leave', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c', { kind: 'group' });
    const d = makeNode('d');
    const root = makeNode('root', { kind: 'group' });
    const isolated = makeNode('isolated');
    renderCanvas({
      project: makeProject(
        [a, b, c, d, root, isolated],
        [
          makeDependency('a-depends-b', a.id, b.id),
          makeMembership(a.id, c.id, 'a-member-c'),
          makeMembership(c.id, root.id, 'c-member-root'),
          makeDependency('b-depends-d', b.id, d.id)
        ]
      )
    });

    const canvas = screen.getByRole('region', { name: 'N2 graph canvas' });
    const rendersBeforeHover = reactFlowRenderSpy.mock.calls.length;
    fireEvent.mouseEnter(nodeById(a.id));

    expect(canvas.hasAttribute('data-network-highlight-active')).toBe(true);
    expect(reactFlowRenderSpy).toHaveBeenCalledTimes(rendersBeforeHover);
    expect(nodeById(a.id).getAttribute('data-network-emphasis')).toBe('focus');
    expect(nodeById(b.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(nodeById(c.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(nodeById(d.id).hasAttribute('data-network-emphasis')).toBe(false);
    expect(nodeById(root.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(nodeById(isolated.id).hasAttribute('data-network-emphasis')).toBe(false);
    expect(edgeById('a-depends-b').getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeById('a-member-c').getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeById('c-member-root').getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeById('b-depends-d').hasAttribute('data-network-emphasis')).toBe(false);

    fireEvent.mouseLeave(nodeById(a.id));

    expect(canvas.hasAttribute('data-network-highlight-active')).toBe(false);
    expect(reactFlowRenderSpy).toHaveBeenCalledTimes(rendersBeforeHover);
    for (const graphNode of [a, b, c, d, root, isolated]) {
      expect(nodeById(graphNode.id).hasAttribute('data-network-emphasis')).toBe(false);
    }
    for (const relationshipId of ['a-depends-b', 'a-member-c', 'c-member-root', 'b-depends-d']) {
      expect(edgeById(relationshipId).hasAttribute('data-network-emphasis')).toBe(false);
    }
  });

  it('keeps the newest hovered network when an older node leave arrives afterward', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');
    renderCanvas({
      project: makeProject(
        [a, b, c],
        [makeDependency('a-depends-b', a.id, b.id), makeDependency('b-depends-c', b.id, c.id)]
      )
    });

    fireEvent.mouseEnter(nodeById(a.id));
    fireEvent.mouseEnter(nodeById(b.id));
    fireEvent.mouseLeave(nodeById(a.id));

    expect(nodeById(a.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(nodeById(b.id).getAttribute('data-network-emphasis')).toBe('focus');
    expect(nodeById(c.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeById('a-depends-b').getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeById('b-depends-c').getAttribute('data-network-emphasis')).toBe('connected');
  });

  it('registers nodes and relationships added by a project refresh into the active network', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');
    const initialRelationship = makeDependency('a-depends-b', a.id, b.id);
    const { replaceProject } = renderCanvas({
      project: makeProject([a, b], [initialRelationship])
    });

    fireEvent.mouseEnter(nodeById(a.id));
    const addedRelationship = makeMembership(a.id, c.id, 'a-member-c');
    replaceProject(makeProject([a, b, c], [initialRelationship, addedRelationship]));

    expect(nodeById(a.id).getAttribute('data-network-emphasis')).toBe('focus');
    expect(nodeById(b.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(nodeById(c.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(edgeById(initialRelationship.id).getAttribute('data-network-emphasis')).toBe(
      'connected'
    );
    expect(edgeById(addedRelationship.id).getAttribute('data-network-emphasis')).toBe('connected');
  });

  it('replaces an active network when only relationships change', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');
    const graphNodes = [a, b, c];
    const oldRelationship = makeDependency('a-depends-b', a.id, b.id);
    const { replaceProject } = renderCanvas({
      project: makeProject(graphNodes, [oldRelationship])
    });

    fireEvent.mouseEnter(nodeById(a.id));
    expect(nodeById(b.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(nodeById(c.id).hasAttribute('data-network-emphasis')).toBe(false);

    const nextRelationship = makeDependency('a-depends-c', a.id, c.id);
    replaceProject(makeProject(graphNodes, [nextRelationship]));

    expect(nodeById(a.id).getAttribute('data-network-emphasis')).toBe('focus');
    expect(nodeById(b.id).hasAttribute('data-network-emphasis')).toBe(false);
    expect(nodeById(c.id).getAttribute('data-network-emphasis')).toBe('connected');
    expect(screen.queryByTestId(`mock-edge-${oldRelationship.id}`)).toBeNull();
    expect(edgeById(nextRelationship.id).getAttribute('data-network-emphasis')).toBe('connected');
  });

  it('focuses an isolated node while dimming the rest of the graph', () => {
    const connectedA = makeNode('connected-a');
    const connectedB = makeNode('connected-b');
    const isolated = makeNode('isolated');
    renderCanvas({
      project: makeProject(
        [connectedA, connectedB, isolated],
        [makeDependency('connected-edge', connectedA.id, connectedB.id)]
      )
    });

    fireEvent.mouseEnter(nodeById(isolated.id));

    expect(nodeById(isolated.id).getAttribute('data-network-emphasis')).toBe('focus');
    expect(nodeById(connectedA.id).hasAttribute('data-network-emphasis')).toBe(false);
    expect(nodeById(connectedB.id).hasAttribute('data-network-emphasis')).toBe(false);
    expect(edgeById('connected-edge').hasAttribute('data-network-emphasis')).toBe(false);

    fireEvent.mouseLeave(nodeById(isolated.id));
    expect(
      screen
        .getByRole('region', { name: 'N2 graph canvas' })
        .hasAttribute('data-network-highlight-active')
    ).toBe(false);
    expect(nodeById(isolated.id).hasAttribute('data-network-emphasis')).toBe(false);
  });

  it('preserves the canvas multi-selection while hovering', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');
    const relationship = makeDependency('a-depends-b', a.id, b.id);
    const { callbacks } = renderCanvas({ project: makeProject([a, b, c], [relationship]) });

    fireEvent.click(screen.getByRole('button', { name: 'Mock select all nodes' }));
    vi.mocked(callbacks.onSelectionChange).mockClear();
    fireEvent.mouseEnter(nodeById(a.id));

    for (const graphNode of [a, b, c]) {
      expect(nodeById(graphNode.id).getAttribute('data-selected')).toBe('true');
    }
    expect(edgeById(relationship.id).getAttribute('data-selected')).toBe('true');
    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
  });

  it('preserves the existing cohort when modifier-clicking another node', () => {
    const first = makeNode('first');
    const second = makeNode('second');
    const third = makeNode('third');
    const { replaceProject } = renderCanvas({ project: makeProject([first, second, third]) });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(nodeById(second.id), { metaKey: true });

    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(third.id).getAttribute('data-selected')).toBe('false');

    replaceProject(
      makeProject([
        { ...first, title: 'First refreshed' },
        { ...second, title: 'Second refreshed' },
        third
      ])
    );

    expect(nodeById(first.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');
    expect(nodeById(third.id).getAttribute('data-selected')).toBe('false');
  });

  it('assigns stable separate label lanes to relationships sharing a node pair', () => {
    const dependency = makeNode('dependency', { kind: 'group', position: { x: 300, y: 0 } });
    renderCanvas({
      project: makeProject(
        [node, dependency],
        [
          makeDependency('dependency-edge', dependency.id, node.id),
          makeMembership(node.id, dependency.id)
        ]
      )
    });

    expect(edgeById('membership').getAttribute('data-edge-lane')).toBe('-1');
    expect(edgeById('dependency-edge').getAttribute('data-edge-lane')).toBe('1');
  });

  it('keeps a relationship selected while deleting and suppresses duplicate commands', async () => {
    const deletion = deferred<void>();
    const onDeleteRelationship = vi.fn().mockReturnValue(deletion.promise);
    const { callbacks } = renderCanvas({
      project: dependencyProject(),
      selection: nodeSelection(node.id),
      callbacks: { onDeleteRelationship }
    });

    const edge = edgeById();
    fireEvent.click(edge);

    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(
      relationshipSelection('dependency-edge')
    );
    expect(edge.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText(/Depends on selected/)).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(onDeleteRelationship).toHaveBeenCalledOnce();
    expect(onDeleteRelationship).toHaveBeenCalledWith('dependency-edge');
    expect(callbacks.onDeleteSelection).not.toHaveBeenCalled();
    expect(edge.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText(/Deleting depends on relationship/)).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.click(edge);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onDeleteRelationship).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(edge.getAttribute('data-selected')).toBe('false');
    fireEvent.click(edge);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onDeleteRelationship).toHaveBeenCalledOnce();

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });
    expect(edge.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText(/Depends on selected/)).toBeTruthy();
  });

  it('clears relationship selection with Escape without deleting it', () => {
    const { callbacks } = renderCanvas({ project: dependencyProject() });
    const edge = edgeById();

    fireEvent.click(edge);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(edge.getAttribute('data-selected')).toBe('false');
    expect(callbacks.onDeleteRelationship).not.toHaveBeenCalled();
  });

  it('dismisses a selected relationship immediately on the first pane click', () => {
    const { callbacks } = renderCanvas({ project: dependencyProject() });
    const edge = edgeById();

    fireEvent.click(edge);
    fireEvent.click(screen.getByRole('button', { name: 'Mock pane' }), { detail: 1 });

    expect(edge.getAttribute('data-selected')).toBe('false');
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(noSelection);
  });

  it('restores a relationship after a double-click and dismisses it on a third click', () => {
    const { callbacks } = renderCanvas({ project: dependencyProject() });
    const edge = edgeById();
    const pane = screen.getByRole('button', { name: 'Mock pane' });

    fireEvent.click(edge);
    fireEvent.click(pane, { detail: 1, clientX: 400, clientY: 300 });
    expect(edge.getAttribute('data-selected')).toBe('false');

    fireEvent.click(pane, { detail: 2, clientX: 400, clientY: 300 });

    expect(edge.getAttribute('data-selected')).toBe('true');
    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();

    fireEvent.click(pane, { detail: 3, clientX: 400, clientY: 300 });

    expect(edge.getAttribute('data-selected')).toBe('false');
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(noSelection);
    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
  });

  it('keeps a newer relationship selection after an immediate pane dismissal', () => {
    renderCanvas({ project: dependencyProject() });

    fireEvent.click(screen.getByRole('button', { name: 'Mock pane' }), { detail: 1 });
    const edge = edgeById();
    fireEvent.click(edge);

    expect(edge.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText(/Depends on selected/)).toBeTruthy();
  });

  it('restores relationship selection after a failed deletion', async () => {
    const onDeleteRelationship = vi.fn().mockRejectedValue(new Error('Delete failed'));
    renderCanvas({ project: dependencyProject(), callbacks: { onDeleteRelationship } });

    const edge = edgeById();
    fireEvent.click(edge);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Delete' });
      await Promise.resolve();
    });

    expect(onDeleteRelationship).toHaveBeenCalledOnce();
    expect(edge.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText(/Depends on selected/)).toBeTruthy();
  });

  it('does not restore a relationship removed between the two pane clicks', async () => {
    const deletion = deferred<void>();
    const initialProject = dependencyProject();
    const { callbacks, replaceProject } = renderCanvas({
      project: initialProject,
      callbacks: { onDeleteRelationship: vi.fn().mockReturnValue(deletion.promise) }
    });

    const pane = screen.getByRole('button', { name: 'Mock pane' });
    const edge = edgeById();
    fireEvent.click(edge);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.click(pane, { detail: 1 });
    expect(edge.getAttribute('data-selected')).toBe('false');

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });
    replaceProject({ ...initialProject, relationships: [] });
    fireEvent.click(pane, { detail: 2, clientX: 400, clientY: 300 });

    expect(screen.queryByTestId('mock-edge-dependency-edge')).toBeNull();
    expect(screen.queryByText(/Depends on selected/)).toBeNull();
    expect(screen.queryByText(/Deleting depends on relationship/)).toBeNull();
    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
  });

  it('clears graph selection when pointer placement becomes active', () => {
    renderCanvas({ project: dependencyProject() });
    const edge = edgeById();

    fireEvent.click(edge);
    fireEvent.click(screen.getByRole('button', { name: /Task node/ }), { detail: 1 });

    expect(edge.getAttribute('data-selected')).toBe('false');
    expect(screen.getByText(/Click the canvas to place a task/)).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Click the canvas to place a task/)).toBeNull();
  });

  it('commits pointer placement once when its click is followed by detail two', () => {
    const { callbacks } = renderCanvas();
    const taskTool = screen.getByRole('button', { name: /Task node/ });
    const pane = screen.getByRole('button', { name: 'Mock pane' });

    fireEvent.click(taskTool, { detail: 1 });
    fireEvent.click(pane, { detail: 1, clientX: 400, clientY: 300 });
    fireEvent.click(pane, { detail: 2, clientX: 400, clientY: 300 });

    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
    expect(callbacks.onCreateNode).toHaveBeenCalledWith('task', { x: 285, y: 230 });
    expect(taskTool.getAttribute('data-placement-active')).toBe('false');
  });

  it('centers Note placement using Note geometry', () => {
    const { callbacks } = renderCanvas();
    const noteTool = screen.getByRole('button', { name: /Note node/ });
    const pane = screen.getByRole('button', { name: 'Mock pane' });

    fireEvent.click(noteTool, { detail: 1 });
    fireEvent.click(pane, { detail: 1, clientX: 400, clientY: 300 });

    expect(callbacks.onCreateNode).toHaveBeenCalledOnce();
    expect(callbacks.onCreateNode).toHaveBeenCalledWith('note', { x: 257, y: 231 });
  });

  it('exits pointer placement whenever a graph item becomes selected', () => {
    const { callbacks } = renderCanvas({ project: dependencyProject() });
    const taskTool = screen.getByRole('button', { name: /Task node/ });

    fireEvent.click(taskTool, { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Mock node' }));
    expect(taskTool.getAttribute('data-placement-active')).toBe('false');
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ nodeIds: [node.id] })
    );

    fireEvent.click(taskTool, { detail: 1 });
    const edge = edgeById();
    fireEvent.click(edge);
    expect(taskTool.getAttribute('data-placement-active')).toBe('false');
    expect(edge.getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(edge.getAttribute('data-selected')).toBe('false');
  });

  it('invalidates stale pane restoration when Escape clears relationship selection', () => {
    renderCanvas({ project: dependencyProject() });

    const pane = screen.getByRole('button', { name: 'Mock pane' });
    const edge = edgeById();
    fireEvent.click(edge);
    fireEvent.click(pane, { detail: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(pane, { detail: 2 });

    expect(edge.getAttribute('data-selected')).toBe('false');
  });

  it('invalidates pane restoration when Escape follows dismissal', () => {
    renderCanvas({ project: dependencyProject() });

    const pane = screen.getByRole('button', { name: 'Mock pane' });
    const edge = edgeById();
    fireEvent.click(edge);
    fireEvent.click(pane, { detail: 1 });
    expect(edge.getAttribute('data-selected')).toBe('false');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(pane, { detail: 2 });

    expect(edge.getAttribute('data-selected')).toBe('false');
  });
});
