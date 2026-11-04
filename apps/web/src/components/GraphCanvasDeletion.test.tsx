import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeSelection } from '../graphInteraction.js';

const { reactFlowRenderSpy } = vi.hoisted(() => ({ reactFlowRenderSpy: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(reactFlowRenderSpy);
});

import {
  edgeById,
  makeDependency,
  makeNode,
  makeProject,
  nodeById,
  renderCanvas
} from './GraphCanvasTestHarness.js';

afterEach(() => {
  cleanup();
  reactFlowRenderSpy.mockClear();
});

const first = makeNode('first');
const second = makeNode('second');
const other = makeNode('other');
const dependency = makeDependency('other-needs-second', other.id, second.id);
const secondDependency = makeDependency('first-needs-second', first.id, second.id);
const twoRelationships = () => makeProject([first, second, other], [dependency, secondDependency]);
const marquee = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Mock select all nodes' }));
};
const press = (key: string): void => {
  fireEvent.keyDown(window, { key });
};

describe('GraphCanvas selection deletion', () => {
  it('deletes the whole multi-selection, in selection order, from one keypress', () => {
    const { callbacks } = renderCanvas({ project: makeProject([first, second]) });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(nodeById(second.id), { metaKey: true });
    press('Delete');

    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id, second.id],
      relationshipIds: []
    });
  });

  it('leaves out a node deselected with a second Ctrl-click', () => {
    const { callbacks } = renderCanvas({ project: makeProject([first, second]) });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(nodeById(second.id), { ctrlKey: true });
    fireEvent.click(nodeById(second.id), { ctrlKey: true });
    press('Delete');

    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id],
      relationshipIds: []
    });
  });

  it('deletes a marquee selection that has no primary node', () => {
    const { callbacks } = renderCanvas({ project: makeProject([first, second]) });

    marquee();
    press('Delete');

    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id, second.id],
      relationshipIds: []
    });
  });

  it('lets a marquee replace the selection with exactly what it encloses', () => {
    const { callbacks } = renderCanvas({
      project: makeProject([first, second, other], [dependency])
    });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(edgeById(dependency.id), { metaKey: true });
    marquee();
    press('Delete');

    expect(callbacks.onDeleteRelationship).not.toHaveBeenCalled();
    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id, second.id, other.id],
      relationshipIds: [dependency.id]
    });
  });

  it('clears a marquee selection with Escape, leaving Delete nothing to remove', () => {
    const { callbacks } = renderCanvas({ project: makeProject([first, second]) });

    marquee();
    press('Escape');
    press('Delete');

    expect(nodeById(first.id).getAttribute('data-selected')).toBe('false');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('false');
    expect(callbacks.onDeleteSelection).not.toHaveBeenCalled();
  });

  it('deletes a relationship selected alongside nodes with them', () => {
    const { callbacks } = renderCanvas({
      project: makeProject([first, second, other], [dependency])
    });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(edgeById(dependency.id), { metaKey: true });
    press('Delete');

    expect(callbacks.onDeleteRelationship).not.toHaveBeenCalled();
    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id],
      relationshipIds: [dependency.id]
    });
  });

  it('keeps a selected relationship when a node is Ctrl-clicked after it', () => {
    const { callbacks } = renderCanvas({ project: twoRelationships() });

    fireEvent.click(edgeById(dependency.id));
    fireEvent.click(nodeById(first.id), { ctrlKey: true });
    press('Delete');

    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id],
      relationshipIds: [dependency.id]
    });
  });

  it('keeps every relationship Ctrl-clicked onto a node selection', () => {
    const { callbacks } = renderCanvas({ project: twoRelationships() });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(edgeById(dependency.id), { ctrlKey: true });
    fireEvent.click(edgeById(secondDependency.id), { ctrlKey: true });
    press('Delete');

    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [first.id],
      relationshipIds: [dependency.id, secondDependency.id]
    });
  });

  it('deletes every selected relationship when no node is selected', () => {
    const { callbacks } = renderCanvas({ project: twoRelationships() });

    fireEvent.click(edgeById(dependency.id));
    fireEvent.click(edgeById(secondDependency.id), { metaKey: true });
    press('Delete');

    expect(callbacks.onDeleteSelection).not.toHaveBeenCalled();
    expect(vi.mocked(callbacks.onDeleteRelationship).mock.calls).toEqual([
      [dependency.id],
      [secondDependency.id]
    ]);
  });

  it('lets a programmatic selection replace the whole canvas selection', () => {
    const { callbacks, replaceSelection } = renderCanvas({ project: twoRelationships() });

    fireEvent.click(nodeById(first.id));
    fireEvent.click(edgeById(dependency.id), { ctrlKey: true });
    replaceSelection(nodeSelection(second.id));

    expect(nodeById(first.id).getAttribute('data-selected')).toBe('false');
    expect(edgeById(dependency.id).getAttribute('data-selected')).toBe('false');
    expect(nodeById(second.id).getAttribute('data-selected')).toBe('true');
    press('Delete');
    expect(callbacks.onDeleteSelection).toHaveBeenCalledExactlyOnceWith({
      nodeIds: [second.id],
      relationshipIds: []
    });
  });
});
