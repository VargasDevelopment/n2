import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { reactFlowRenderSpy } = vi.hoisted(() => ({ reactFlowRenderSpy: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(reactFlowRenderSpy);
});

import {
  makeNode,
  makeNote,
  makeProject,
  nodeById,
  renderCanvas
} from './GraphCanvasTestHarness.js';

afterEach(() => {
  cleanup();
  reactFlowRenderSpy.mockClear();
});

describe('GraphCanvas Kanban interactions', () => {
  it('treats positions as derived and drops work by requested status only', () => {
    const blocked = makeNode('blocked', {
      requestedStatus: 'ready',
      effectiveStatus: 'blocked',
      position: { x: 900, y: 700 }
    });
    const note = makeNote();
    const { callbacks } = renderCanvas({
      project: makeProject([blocked, note]),
      transformations: new Set(['kanban'])
    });

    expect(screen.queryByRole('button', { name: /^Task node/ })).toBeNull();
    expect(nodeById(blocked.id).getAttribute('data-node-x')).not.toBe('900');
    expect(nodeById(blocked.id).getAttribute('data-node-draggable')).toBe('true');
    expect(nodeById(blocked.id).getAttribute('data-node-focusable')).toBe('false');
    expect(nodeById(note.id).getAttribute('data-node-draggable')).toBe('false');
    expect(nodeById(note.id).getAttribute('data-node-height')).toBe('360');

    const derivedX = nodeById(blocked.id).getAttribute('data-node-x');
    fireEvent.click(screen.getByRole('button', { name: 'Mock nudge first node' }));
    expect(nodeById(blocked.id).getAttribute('data-node-x')).toBe(derivedX);

    fireEvent.click(
      screen.getByRole('button', { name: 'Mock move first node to next Kanban column' })
    );

    expect(callbacks.onSetRequestedStatus).toHaveBeenCalledOnce();
    expect(callbacks.onSetRequestedStatus).toHaveBeenCalledWith(blocked, 'done');
    expect(callbacks.onMoveNodes).not.toHaveBeenCalled();
    expect(nodeById(blocked.id).getAttribute('data-node-x')).not.toBe('900');
  });

  it('removes folded Note presentation when returning to Freeform', () => {
    const note = makeNote();
    renderCanvas({ project: makeProject([note]), transformations: new Set(['kanban']) });
    const renderedNote = nodeById(note.id);

    expect(renderedNote.getAttribute('data-node-height')).toBe('360');
    expect(renderedNote.parentElement?.classList.contains('n2-canvas-note--folded')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Freeform' }));

    expect(renderedNote.hasAttribute('data-node-height')).toBe(false);
    expect(renderedNote.parentElement?.classList.contains('n2-canvas-note--folded')).toBe(false);
  });
});
