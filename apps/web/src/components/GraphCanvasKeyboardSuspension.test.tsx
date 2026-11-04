import type { ProjectedNode } from '@n2/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivitySession } from '../activityQueries.js';

const { reactFlowRenderSpy } = vi.hoisted(() => ({ reactFlowRenderSpy: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const { createGraphCanvasReactFlowMock } = await import('./GraphCanvasReactFlowMock.js');
  return createGraphCanvasReactFlowMock(reactFlowRenderSpy);
});

import { ActivityPanel } from './ActivityPanel.js';
import { dependencyProject, edgeById, renderCanvas } from './GraphCanvasTestHarness.js';
import { Inspector } from './Inspector.js';

afterEach(() => {
  cleanup();
  reactFlowRenderSpy.mockClear();
});

const session: ActivitySession = {
  activity: undefined,
  open: true,
  close: () => undefined,
  toggle: () => undefined
};

const task: ProjectedNode = {
  id: 'inspected',
  reference: 'N2-9',
  title: 'Inspected',
  description: '',
  kind: 'task',
  requestedStatus: 'ready',
  effectiveStatus: 'ready',
  progress: 0,
  blockedBy: [],
  position: { x: 0, y: 0 },
  version: 0,
  createdAt: '2026-08-21T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z'
};

describe('GraphCanvas keyboard ownership', () => {
  it('suspends destructive shortcuts while an overlay owns the keyboard', () => {
    const onDeleteRelationship = vi.fn().mockResolvedValue(undefined);
    renderCanvas({
      project: dependencyProject(),
      callbacks: { onDeleteRelationship },
      keyboardShortcutsEnabled: false
    });

    const edge = edgeById();
    fireEvent.click(edge);
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(onDeleteRelationship).not.toHaveBeenCalled();
    expect(edge.getAttribute('data-selected')).toBe('true');
  });

  it.each([
    {
      panel: 'the Activity sheet',
      renderPanel: () => render(<ActivityPanel session={session} onOpenItem={vi.fn()} />),
      focusTarget: () => screen.getByRole('heading', { name: 'What changed' })
    },
    {
      panel: 'the Inspector',
      renderPanel: () =>
        render(
          <Inspector
            node={task}
            placement="bottom"
            onClose={vi.fn()}
            onDelete={vi.fn()}
            onUpdate={vi.fn()}
          />
        ),
      focusTarget: () => screen.getByRole('complementary', { name: 'Details for Inspected' })
    }
  ])('never deletes the canvas selection from $panel', ({ renderPanel, focusTarget }) => {
    const onDeleteRelationship = vi.fn().mockResolvedValue(undefined);
    renderCanvas({ project: dependencyProject(), callbacks: { onDeleteRelationship } });
    renderPanel();
    const edge = edgeById();
    fireEvent.click(edge);

    // Focus in the panel, and a press on its plain text that leaves focus on the page.
    const inPanel = focusTarget();
    fireEvent.pointerDown(inPanel);
    fireEvent.keyDown(inPanel, { key: 'Backspace' });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(onDeleteRelationship).not.toHaveBeenCalled();

    // Back on the canvas, Delete is the canvas's again.
    fireEvent.pointerDown(edge);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(onDeleteRelationship).toHaveBeenCalledWith('dependency-edge');
  });
});
