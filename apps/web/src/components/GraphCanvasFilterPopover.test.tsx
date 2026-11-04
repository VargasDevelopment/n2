import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeSelection } from '../graphInteraction.js';

const { reactFlowRenderSpy } = vi.hoisted(() => ({ reactFlowRenderSpy: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(reactFlowRenderSpy);
});

import { node, nodeById, renderCanvas } from './GraphCanvasTestHarness.js';

afterEach(() => {
  cleanup();
  reactFlowRenderSpy.mockClear();
});

describe('GraphCanvas filter popover', () => {
  it('lets Escape dismiss filters without clearing the underlying node selection', () => {
    const { callbacks } = renderCanvas({
      selection: nodeSelection(node.id)
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
  });

  it('lets Escape dismiss filters without canceling active node placement', () => {
    renderCanvas();
    const taskTool = screen.getByRole('button', { name: /Task node/ });
    fireEvent.click(taskTool, { detail: 1 });
    expect(taskTool.getAttribute('data-placement-active')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(taskTool.getAttribute('data-placement-active')).toBe('true');
  });

  it('consumes an outside pane click while dismissing over a selected node', () => {
    const { callbacks } = renderCanvas({
      selection: nodeSelection(node.id)
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mock pane' }));

    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
  });

  it('consumes an outside pane click while dismissing during node placement', () => {
    const { callbacks } = renderCanvas();
    const taskTool = screen.getByRole('button', { name: /Task node/ });
    fireEvent.click(taskTool, { detail: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mock pane' }), {
      detail: 1,
      clientX: 400,
      clientY: 300
    });

    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(taskTool.getAttribute('data-placement-active')).toBe('true');
    expect(callbacks.onCreateNode).not.toHaveBeenCalled();
  });

  it('blocks an outside pointer gesture from starting a canvas drag before dismissal', () => {
    renderCanvas();
    fireEvent.click(screen.getByRole('button', { name: 'Mock select all nodes' }));
    const renderedNode = nodeById(node.id);
    const originalX = renderedNode.getAttribute('data-node-x');

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const drag = screen.getByRole('button', { name: 'Mock move selected nodes' });
    fireEvent.pointerDown(drag);

    expect(renderedNode.getAttribute('data-node-x')).toBe(originalX);
    expect(screen.getByRole('group', { name: 'Status filters' })).not.toBeNull();

    fireEvent.pointerUp(drag);
    fireEvent.click(drag);
    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
    expect(renderedNode.getAttribute('data-node-x')).toBe(originalX);
  });
});
